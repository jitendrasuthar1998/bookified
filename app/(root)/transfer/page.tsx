"use client";

import React, { useEffect, useState, useRef, useTransition } from "react";
import Image from "next/image";
import {
  Laptop,
  Smartphone,
  Monitor,
  Wifi,
  QrCode,
  Copy,
  Check,
  Send,
  Download,
  FileText,
  FileCheck,
  AlertCircle,
  RefreshCw,
  FolderUp,
  Share2,
  FileIcon,
  X,
  MessageSquare,
  ShieldCheck,
  Zap,
  ArrowRightLeft,
} from "lucide-react";
import { generateQrCodeDataUrl } from "@/lib/qr-code";

interface Peer {
  id: string;
  name: string;
  deviceType: "mac" | "android" | "windows" | "ios" | "unknown";
  lastSeen: number;
}

interface TransferringFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  speed: string;
  direction: "sending" | "receiving";
  status: "transferring" | "completed" | "error";
  blobUrl?: string;
}

interface SharedMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export default function TransferPage() {
  // Device identity
  const [peerId] = useState<string>(() =>
    typeof window !== "undefined"
      ? "p_" + Math.random().toString(36).substring(2, 9)
      : "local-peer"
  );
  const [deviceName, setDeviceName] = useState<string>("My Device");
  const [deviceType, setDeviceType] = useState<"mac" | "android" | "windows" | "ios" | "unknown">("unknown");
  
  // Room & Network State
  const [roomId, setRoomId] = useState<string>("quick-room");
  const [localIp, setLocalIp] = useState<string>("");
  const [shareUrl, setShareUrl] = useState<string>("");
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Peers & Active Connection
  const [peers, setPeers] = useState<Peer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<Peer | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "fallback">("idle");
  const [transferMode, setTransferMode] = useState<"p2p" | "lan_http">("p2p");

  // Transfers
  const [activeTransfers, setActiveTransfers] = useState<TransferringFile[]>([]);
  const [historyFiles, setHistoryFiles] = useState<TransferringFile[]>([]);
  const [dragOver, setDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Text / Clipboard messages
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"files" | "chat">("files");

  // WebRTC References
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const receivedChunksRef = useRef<Map<string, { chunks: Uint8Array[]; meta: any; receivedBytes: number }>>(new Map());

  // Detect user agent & initialize device profile
  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = navigator.userAgent;
    let detectedType: "mac" | "android" | "windows" | "ios" | "unknown" = "unknown";
    let defaultName = "Web Device";

    if (/Android/i.test(ua)) {
      detectedType = "android";
      defaultName = "Android Phone";
    } else if (/Macintosh|Mac OS X/i.test(ua)) {
      detectedType = "mac";
      defaultName = "MacBook";
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      detectedType = "ios";
      defaultName = "iPhone";
    } else if (/Windows/i.test(ua)) {
      detectedType = "windows";
      defaultName = "Windows PC";
    }

    setDeviceType(detectedType);
    setDeviceName(defaultName);

    // Extract room from URL or persist
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomId(roomParam);
    } else {
      const generatedRoom = Math.floor(1000 + Math.random() * 9000).toString();
      setRoomId(generatedRoom);
      const newUrl = `${window.location.pathname}?room=${generatedRoom}`;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  // Fetch host machine local IP info
  useEffect(() => {
    async function fetchNetworkInfo() {
      try {
        const res = await fetch("/api/transfer/network-info");
        const data = await res.json();
        if (data.success && data.primaryIp) {
          setLocalIp(data.primaryIp);
          const fullUrl = `http://${data.primaryIp}:${data.port || "3000"}/transfer?room=${roomId}`;
          setShareUrl(fullUrl);
          const qr = await generateQrCodeDataUrl(fullUrl);
          setQrCodeUrl(qr);
        } else {
          const fallback = window.location.href;
          setShareUrl(fallback);
          const qr = await generateQrCodeDataUrl(fallback);
          setQrCodeUrl(qr);
        }
      } catch (e) {
        const fallback = window.location.href;
        setShareUrl(fallback);
        generateQrCodeDataUrl(fallback).then(setQrCodeUrl);
      }
    }

    if (roomId) {
      fetchNetworkInfo();
    }
  }, [roomId]);

  // Audio chimes
  const playChime = (type: "sent" | "received") => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "sent") {
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      } else {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1180, ctx.currentTime + 0.2);
      }

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  };

  // Heartbeat & Signal Polling
  useEffect(() => {
    if (!roomId || !peerId) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/transfer/signal?roomId=${roomId}&peerId=${peerId}&deviceName=${encodeURIComponent(
            deviceName
          )}&deviceType=${deviceType}`
        );
        const data = await res.json();

        if (isMounted && data.success) {
          // Filter out self
          const otherPeers: Peer[] = (data.peers || []).filter((p: Peer) => p.id !== peerId);
          setPeers(otherPeers);

          // If there's an active peer and none selected, auto-select
          if (otherPeers.length > 0 && !selectedPeer) {
            setSelectedPeer(otherPeers[0]);
          }

          // Handle incoming signal messages (WebRTC negotiation)
          if (data.messages && data.messages.length > 0) {
            for (const msg of data.messages) {
              handleIncomingSignal(msg);
            }
          }
        }
      } catch (err) {
        // network polling error
      }
    }, 1200);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [roomId, peerId, deviceName, deviceType, selectedPeer]);

  // WebRTC Setup Helper
  const setupPeerConnection = (targetPeerId: string) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await sendSignal(targetPeerId, "candidate", event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setConnectionStatus("connected");
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setConnectionStatus("fallback");
        setTransferMode("lan_http");
      }
    };

    // When receiving remote data channel
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      setupDataChannelEvents(channel);
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  const setupDataChannelEvents = (channel: RTCDataChannel) => {
    dataChannelRef.current = channel;
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      setConnectionStatus("connected");
    };

    channel.onclose = () => {
      setConnectionStatus("idle");
    };

    channel.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === "chat") {
            setMessages((prev) => [
              ...prev,
              {
                id: Math.random().toString(),
                sender: parsed.sender,
                text: parsed.text,
                timestamp: Date.now(),
              },
            ]);
            playChime("received");
          } else if (parsed.type === "file-start") {
            // New incoming file stream
            receivedChunksRef.current.set(parsed.id, {
              meta: parsed,
              chunks: [],
              receivedBytes: 0,
            });
            setActiveTransfers((prev) => [
              {
                id: parsed.id,
                name: parsed.name,
                size: parsed.size,
                progress: 0,
                speed: "Connecting...",
                direction: "receiving",
                status: "transferring",
              },
              ...prev,
            ]);
          } else if (parsed.type === "file-end") {
            // Complete received file
            const fileData = receivedChunksRef.current.get(parsed.id);
            if (fileData) {
              const blob = new Blob(fileData.chunks as unknown as BlobPart[], {
                type: fileData.meta.mimeType || "application/octet-stream",
              });
              const blobUrl = URL.createObjectURL(blob);

              setActiveTransfers((prev) =>
                prev.map((t) =>
                  t.id === parsed.id
                    ? { ...t, progress: 100, status: "completed", speed: "Finished", blobUrl }
                    : t
                )
              );

              setHistoryFiles((prev) => [
                {
                  id: parsed.id,
                  name: fileData.meta.name,
                  size: fileData.meta.size,
                  progress: 100,
                  speed: "100%",
                  direction: "receiving",
                  status: "completed",
                  blobUrl,
                },
                ...prev,
              ]);

              playChime("received");
              receivedChunksRef.current.delete(parsed.id);

              // Auto-trigger download on mobile or desktop
              const a = document.createElement("a");
              a.href = blobUrl;
              a.download = fileData.meta.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
          }
        } catch (e) {
          console.error("Signal parse error:", e);
        }
      } else {
        // Binary chunk received
        const chunk = new Uint8Array(event.data);
        // Find corresponding receiving transfer
        const entries = Array.from(receivedChunksRef.current.entries());
        if (entries.length > 0) {
          const [fileId, fileState] = entries[entries.length - 1];
          fileState.chunks.push(chunk);
          fileState.receivedBytes += chunk.byteLength;

          const progress = Math.min(100, Math.round((fileState.receivedBytes / fileState.meta.size) * 100));

          setActiveTransfers((prev) =>
            prev.map((t) =>
              t.id === fileId
                ? {
                    ...t,
                    progress,
                    speed: `${(fileState.receivedBytes / (1024 * 1024)).toFixed(1)} MB / ${(
                      fileState.meta.size /
                      (1024 * 1024)
                    ).toFixed(1)} MB`,
                  }
                : t
            )
          );
        }
      }
    };
  };

  // Send signaling message via Next.js API
  const sendSignal = async (to: string, type: string, payload: any) => {
    try {
      await fetch("/api/transfer/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          from: peerId,
          to,
          type,
          payload,
        }),
      });
    } catch (e) {}
  };

  // Handle incoming signaling messages
  const handleIncomingSignal = async (msg: any) => {
    const { from, type, payload } = msg;

    if (type === "offer") {
      const pc = setupPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(from, "answer", answer);
    } else if (type === "answer") {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload));
      }
    } else if (type === "candidate") {
      if (peerConnectionRef.current && payload) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload));
        } catch (e) {}
      }
    }
  };

  // Connect to peer and create WebRTC Offer
  const initiateConnection = async (targetPeer: Peer) => {
    setSelectedPeer(targetPeer);
    setConnectionStatus("connecting");

    const pc = setupPeerConnection(targetPeer.id);
    const dataChannel = pc.createDataChannel("airdrop-transfer", {
      ordered: true,
    });
    setupDataChannelEvents(dataChannel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal(targetPeer.id, "offer", offer);
  };

  // Send file via WebRTC Chunking or LAN HTTP Fallback
  const handleSendFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const transferId = Math.random().toString(36).substring(2, 9);

      const newTransfer: TransferringFile = {
        id: transferId,
        name: file.name,
        size: file.size,
        progress: 0,
        speed: "Starting...",
        direction: "sending",
        status: "transferring",
      };

      setActiveTransfers((prev) => [newTransfer, ...prev]);

      // If WebRTC data channel is open, stream chunk by chunk
      if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
        await streamFileP2P(file, transferId);
      } else {
        // Fallback to LAN HTTP upload
        await uploadFileLan(file, transferId);
      }
    }
  };

  // Stream binary chunks over WebRTC RTCDataChannel (64KB chunks with flow control)
  const streamFileP2P = async (file: File, transferId: string) => {
    const channel = dataChannelRef.current!;
    const CHUNK_SIZE = 64 * 1024; // 64KB
    let offset = 0;
    const startTime = Date.now();

    // 1. Notify receiver of file metadata
    channel.send(
      JSON.stringify({
        type: "file-start",
        id: transferId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
      })
    );

    const reader = file.stream().getReader();

    while (offset < file.size) {
      // Buffer flow control
      if (channel.bufferedAmount > 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const arrayBuffer = await slice.arrayBuffer();
      channel.send(arrayBuffer);

      offset += arrayBuffer.byteLength;
      const progress = Math.min(100, Math.round((offset / file.size) * 100));
      const elapsed = (Date.now() - startTime) / 1000;
      const speedMBps = elapsed > 0 ? (offset / (1024 * 1024) / elapsed).toFixed(1) : "0";

      setActiveTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? {
                ...t,
                progress,
                speed: `${speedMBps} MB/s (${(offset / (1024 * 1024)).toFixed(1)} MB / ${(
                  file.size /
                  (1024 * 1024)
                ).toFixed(1)} MB)`,
              }
            : t
        )
      );
    }

    // 2. Notify receiver file is finished
    channel.send(
      JSON.stringify({
        type: "file-end",
        id: transferId,
      })
    );

    playChime("sent");

    setActiveTransfers((prev) =>
      prev.map((t) =>
        t.id === transferId ? { ...t, progress: 100, status: "completed", speed: "Sent Successfully" } : t
      )
    );

    setHistoryFiles((prev) => [
      {
        id: transferId,
        name: file.name,
        size: file.size,
        progress: 100,
        speed: "Completed",
        direction: "sending",
        status: "completed",
      },
      ...prev,
    ]);
  };

  // Fallback: Upload to local LAN endpoint
  const uploadFileLan = async (file: File, transferId: string) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("roomId", roomId);
      formData.append("senderName", deviceName);
      formData.append("senderId", peerId);

      setActiveTransfers((prev) =>
        prev.map((t) => (t.id === transferId ? { ...t, speed: "Uploading to Local LAN..." } : t))
      );

      const res = await fetch("/api/transfer/fallback", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        setActiveTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId ? { ...t, progress: 100, status: "completed", speed: "Sent via Local Wi-Fi" } : t
          )
        );
        playChime("sent");
        setHistoryFiles((prev) => [
          {
            id: transferId,
            name: file.name,
            size: file.size,
            progress: 100,
            speed: "Completed",
            direction: "sending",
            status: "completed",
          },
          ...prev,
        ]);
      }
    } catch (e) {
      setActiveTransfers((prev) =>
        prev.map((t) => (t.id === transferId ? { ...t, status: "error", speed: "Upload failed" } : t))
      );
    }
  };

  // Send Text Message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const message: SharedMessage = {
      id: Math.random().toString(),
      sender: deviceName,
      text: inputText.trim(),
      timestamp: Date.now(),
    };

    if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
      dataChannelRef.current.send(
        JSON.stringify({
          type: "chat",
          sender: deviceName,
          text: inputText.trim(),
        })
      );
    }

    setMessages((prev) => [...prev, message]);
    setInputText("");
    playChime("sent");
  };

  // Copy URL to clipboard
  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl || window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format file size
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Helper icon for device
  const getDeviceIcon = (type: string, className = "w-6 h-6") => {
    switch (type) {
      case "mac":
        return <Laptop className={className} />;
      case "android":
      case "ios":
        return <Smartphone className={className} />;
      case "windows":
        return <Monitor className={className} />;
      default:
        return <Laptop className={className} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pt-20 pb-12 px-4 sm:px-6 lg:px-8 selection:bg-indigo-500 selection:text-white">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Top Header Card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  AirDrop / P2P Local Active
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-800/80 text-slate-300 border border-slate-700">
                  Room #{roomId}
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white flex items-center gap-3">
                <ArrowRightLeft className="w-8 h-8 text-indigo-400" />
                Mac ⇄ Android QuickDrop
              </h1>
              <p className="text-sm md:text-base text-slate-400 max-w-2xl">
                Transfer files, photos, videos, & text directly over your local Wi-Fi or phone hotspot. 
                Zero mobile data used, maximum Wi-Fi speed, 100% private.
              </p>
            </div>

            {/* Quick Actions / QR Code Button */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowQrModal(true)}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-600/25 active:scale-95"
              >
                <QrCode className="w-4 h-4" />
                Scan Phone QR
              </button>

              <button
                onClick={copyShareLink}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-sm transition-all active:scale-95"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                {copied ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>
        </div>

        {/* Main 2-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Radar & Discovered Devices (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* AirDrop Radar Card */}
            <div className="relative rounded-3xl bg-slate-900/90 border border-slate-800 p-6 md:p-8 shadow-xl overflow-hidden flex flex-col items-center justify-center min-h-[420px]">
              {/* Radar Rings Background */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 rounded-full border border-indigo-500/10 animate-ping [animation-duration:4s]" />
                <div className="w-72 h-72 rounded-full border border-indigo-500/10" />
                <div className="w-96 h-96 rounded-full border border-indigo-500/5" />
              </div>

              {/* Status Header */}
              <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-6 z-10">
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-indigo-400 animate-pulse" />
                  <span>Looking for nearby devices on same Wi-Fi / Hotspot...</span>
                </div>
                <span className="font-semibold text-slate-300">
                  {peers.length} Device{peers.length === 1 ? "" : "s"} Found
                </span>
              </div>

              {/* Discovered Devices Cluster */}
              <div className="z-10 flex flex-wrap items-center justify-center gap-6 my-auto py-8">
                {peers.length === 0 ? (
                  <div className="text-center space-y-3 max-w-sm px-4">
                    <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto text-indigo-400 animate-bounce">
                      <QrCode className="w-8 h-8" />
                    </div>
                    <h3 className="font-semibold text-slate-200">No other device connected yet</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Apne phone ke camera se upar diya gaya <strong className="text-indigo-400">QR Code scan karein</strong> ya link open karein. Phone aate hi yahan radar par dikhega!
                    </p>
                    <button
                      onClick={() => setShowQrModal(true)}
                      className="inline-flex items-center gap-2 text-xs font-medium text-indigo-400 hover:text-indigo-300 underline"
                    >
                      Show QR Code Now →
                    </button>
                  </div>
                ) : (
                  peers.map((peer) => {
                    const isSelected = selectedPeer?.id === peer.id;
                    return (
                      <div
                        key={peer.id}
                        onClick={() => initiateConnection(peer)}
                        className={`group cursor-pointer relative flex flex-col items-center gap-3 p-5 rounded-2xl transition-all duration-300 ${
                          isSelected
                            ? "bg-indigo-600/20 border-2 border-indigo-500 shadow-lg shadow-indigo-500/20 scale-105"
                            : "bg-slate-800/80 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800"
                        }`}
                      >
                        <div className="relative">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-md group-hover:scale-110 transition-transform">
                            {getDeviceIcon(peer.deviceType, "w-8 h-8")}
                          </div>
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-slate-900" />
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-sm text-slate-100 group-hover:text-indigo-300">
                            {peer.name}
                          </p>
                          <span className="text-[11px] text-slate-400 capitalize">
                            {peer.deviceType} • Click to Pair
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Self Device Identity Badge */}
              <div className="z-10 mt-auto pt-6 border-t border-slate-800/80 w-full flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400">
                    {getDeviceIcon(deviceType)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">This Device:</span>
                      <input
                        type="text"
                        value={deviceName}
                        onChange={(e) => setDeviceName(e.target.value)}
                        className="bg-transparent border-b border-dashed border-slate-600 text-xs font-semibold text-white focus:outline-none focus:border-indigo-400"
                        title="Click to rename"
                      />
                    </div>
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Ready for transfer ({deviceType.toUpperCase()})
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-slate-400 block">Connection Protocol</span>
                  <span className="text-xs font-medium text-indigo-400 flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    {connectionStatus === "connected" ? "WebRTC P2P (Direct)" : "Local LAN Active"}
                  </span>
                </div>
              </div>
            </div>

            {/* Drag & Drop Send Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files) {
                  handleSendFiles(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer border-2 border-dashed rounded-3xl p-8 text-center transition-all ${
                dragOver
                  ? "border-indigo-400 bg-indigo-500/10 scale-[1.01]"
                  : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleSendFiles(e.target.files)}
              />
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-4">
                <FolderUp className="w-7 h-7" />
              </div>
              <h3 className="text-base font-semibold text-slate-200">
                Choose files or drag & drop here
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Photos, Videos, PDFs, Audio, APKs, Documents (Any size supported)
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <span className="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-medium">
                  Direct High Speed
                </span>
                <span className="px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-medium">
                  Unlimited Size
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Live Transfers, Received Files, & Text Sharing (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Tabs Header */}
            <div className="flex rounded-2xl bg-slate-900 p-1 border border-slate-800">
              <button
                onClick={() => setActiveTab("files")}
                className={`flex-1 py-2.5 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all ${
                  activeTab === "files"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <FileIcon className="w-4 h-4" />
                Files & Transfers ({activeTransfers.length + historyFiles.length})
              </button>
              <button
                onClick={() => setActiveTab("chat")}
                className={`flex-1 py-2.5 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all ${
                  activeTab === "chat"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Quick Text & Clipboard
              </button>
            </div>

            {/* TAB 1: Files & Transfer Queue */}
            {activeTab === "files" && (
              <div className="space-y-4">
                
                {/* Active Transfer Progress Bars */}
                {activeTransfers.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Live Transfer Activity
                    </h4>
                    {activeTransfers.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3 shadow-lg"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="font-semibold truncate max-w-[180px] text-slate-200">
                              {item.name}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                              {formatBytes(item.size)}
                            </span>
                          </div>
                          <span className="text-indigo-400 font-bold">{item.progress}%</span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-full transition-all duration-200 rounded-full"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>{item.speed}</span>
                          <span className="capitalize font-medium text-slate-300">
                            {item.direction === "sending" ? "↗ Sending" : "↙ Receiving"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Received / Downloadable History List */}
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Recent Files in Session
                    </h4>
                    {historyFiles.length > 0 && (
                      <span className="text-xs text-emerald-400 flex items-center gap-1">
                        <FileCheck className="w-3.5 h-3.5" /> Ready
                      </span>
                    )}
                  </div>

                  {historyFiles.length === 0 && activeTransfers.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 space-y-2">
                      <FileText className="w-8 h-8 mx-auto opacity-40" />
                      <p className="text-xs">No files transferred yet.</p>
                      <p className="text-[11px] text-slate-600">
                        Drop a file or select a photo to begin instant sharing.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                      {historyFiles.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:bg-slate-800 transition-all text-xs"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                              <FileCheck className="w-4 h-4" />
                            </div>
                            <div className="truncate">
                              <p className="font-semibold text-slate-200 truncate">{file.name}</p>
                              <p className="text-[10px] text-slate-400">
                                {formatBytes(file.size)} • {file.direction === "receiving" ? "Received" : "Sent"}
                              </p>
                            </div>
                          </div>

                          {file.blobUrl && (
                            <a
                              href={file.blobUrl}
                              download={file.name}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1 shrink-0 transition-all"
                            >
                              <Download className="w-3.5 h-3.5" /> Save
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: Text / Clipboard Instant Share */}
            {activeTab === "chat" && (
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4 flex flex-col h-[400px]">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                  <span className="font-semibold text-slate-300">Shared Clipboard & Notes</span>
                  <span className="text-[11px] text-slate-500">Instant Sync</span>
                </div>

                {/* Messages Container */}
                <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 space-y-2">
                      <MessageSquare className="w-8 h-8 opacity-40" />
                      <p>Send links, codes, or text snippets between phone and laptop instantly.</p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isMe = m.sender === deviceName;
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isMe ? "items-end" : "items-start"} space-y-1`}
                        >
                          <span className="text-[10px] text-slate-500">{m.sender}</span>
                          <div
                            className={`p-3 rounded-2xl max-w-[85%] break-words ${
                              isMe
                                ? "bg-indigo-600 text-white rounded-br-none"
                                : "bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700"
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{m.text}</p>
                            <button
                              onClick={() => navigator.clipboard.writeText(m.text)}
                              className="mt-1 text-[10px] opacity-75 hover:opacity-100 flex items-center gap-1"
                            >
                              <Copy className="w-2.5 h-2.5" /> Copy
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Input Form */}
                <form onSubmit={handleSendMessage} className="flex gap-2 pt-2 border-t border-slate-800">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Paste link or type message..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Instructions Footer Banner */}
        <div className="rounded-2xl bg-slate-900/40 border border-slate-800/80 p-5 text-xs text-slate-400 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 font-bold">
              1
            </div>
            <div>
              <strong className="text-slate-200 block">Hotspot / Wi-Fi Connect</strong>
              Apne phone ka Hotspot on karke Mac connect karein, ya dono ko same Wi-Fi par rakhein.
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 font-bold">
              2
            </div>
            <div>
              <strong className="text-slate-200 block">QR Code Scan</strong>
              Phone camera se screen ka QR Code scan karein ya URL phone ke browser me open karein.
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 font-bold">
              3
            </div>
            <div>
              <strong className="text-slate-200 block">Direct Fast Transfer</strong>
              File drop karein — P2P Local Wi-Fi channel ke through bina internet kharch kiye direct transfer hoga.
            </div>
          </div>
        </div>

      </div>

      {/* QR Code Popup Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white flex items-center justify-center gap-2">
              <Smartphone className="w-5 h-5 text-indigo-400" />
              Scan with Phone Camera
            </h3>
            <p className="text-xs text-slate-400">
              Open your Android phone's Camera or Google Lens to connect instantly.
            </p>

            {/* QR Code Display */}
            <div className="bg-white p-4 rounded-2xl inline-block shadow-inner">
              {qrCodeUrl ? (
                <img
                  src={qrCodeUrl}
                  alt="Scan to connect phone"
                  width={240}
                  height={240}
                  className="rounded-lg mx-auto"
                />
              ) : (
                <div className="w-[240px] h-[240px] flex items-center justify-center text-slate-500 text-xs">
                  Generating QR...
                </div>
              )}
            </div>

            {/* Share URL Box */}
            <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-800 border border-slate-700 text-left">
              <span className="text-[11px] text-slate-300 truncate flex-1 font-mono">
                {shareUrl || "Loading local URL..."}
              </span>
              <button
                onClick={copyShareLink}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <p className="text-[11px] text-slate-500">
              Room ID: <strong className="text-slate-300">#{roomId}</strong> • Local IP: {localIp || "Auto"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
