"use client";

import React, { useEffect, useState, useRef } from "react";
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
  FileCheck,
  FolderUp,
  X,
  MessageSquare,
  ArrowRightLeft,
  BellRing,
  FileText,
  Zap,
} from "lucide-react";
import { generateQrCodeDataUrl } from "@/lib/qr-code";

interface Peer {
  id: string;
  name: string;
  deviceType: "mac" | "android" | "windows" | "ios" | "unknown";
  lastSeen: number;
}

interface SharedFileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  senderName: string;
  senderId: string;
  uploadedAt: number;
  downloadUrl?: string;
  blobUrl?: string;
}

interface TransferringItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  speed: string;
  status: "transferring" | "completed" | "error";
  mode: "p2p" | "lan";
}

interface ChatMessage {
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
      : "peer"
  );
  const [deviceName, setDeviceName] = useState<string>("My Device");
  const [deviceType, setDeviceType] = useState<"mac" | "android" | "windows" | "ios" | "unknown">("unknown");

  // Room state
  const [roomId, setRoomId] = useState<string>("quick-room");
  const [localIp, setLocalIp] = useState<string>("");
  const [shareUrl, setShareUrl] = useState<string>("");
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Connected Peer & WebRTC State
  const [connectedPeer, setConnectedPeer] = useState<Peer | null>(null);
  const [isP2PConnected, setIsP2PConnected] = useState<boolean>(false);
  const lastSeenPeerTimeRef = useRef<number>(0);

  // WebRTC References
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const isInitiatingRef = useRef<boolean>(false);

  // Active Receiving Buffer (In-memory P2P stream)
  const receivingFileRef = useRef<{
    meta: any;
    chunks: ArrayBuffer[];
    receivedBytes: number;
    startTime: number;
  } | null>(null);

  // Files & Queue
  const [transfers, setTransfers] = useState<TransferringItem[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<SharedFileItem[]>([]);
  const [newFileAlert, setNewFileAlert] = useState<SharedFileItem | null>(null);

  // Text / Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"send" | "received" | "chat">("send");

  // Drag over & File ref
  const [dragOver, setDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Audio Chime
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

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  };

  // Device & Room Detection
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

  // Fetch Host Local IP & QR Code
  useEffect(() => {
    async function initNetwork() {
      try {
        const res = await fetch("/api/transfer/network-info");
        const data = await res.json();
        const hostIp = data.success && data.primaryIp ? data.primaryIp : window.location.hostname;
        const port = data.port || (window.location.port ? window.location.port : "3000");
        const fullUrl = `http://${hostIp}:${port}/transfer?room=${roomId}`;

        setLocalIp(hostIp);
        setShareUrl(fullUrl);
        const qr = await generateQrCodeDataUrl(fullUrl);
        setQrCodeUrl(qr);
      } catch (e) {
        const fallbackUrl = window.location.href;
        setShareUrl(fallbackUrl);
        generateQrCodeDataUrl(fallbackUrl).then(setQrCodeUrl);
      }
    }

    if (roomId) {
      initNetwork();
    }
  }, [roomId]);

  // Send Signal Helper
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

  // Setup WebRTC DataChannel Events
  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      setIsP2PConnected(true);
      dataChannelRef.current = channel;
    };

    channel.onclose = () => {
      setIsP2PConnected(false);
    };

    channel.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "chat") {
            setMessages((prev) => [
              ...prev,
              {
                id: Math.random().toString(),
                sender: msg.sender,
                text: msg.text,
                timestamp: Date.now(),
              },
            ]);
            playChime("received");
          } else if (msg.type === "file-start") {
            // High-speed incoming P2P file header
            receivingFileRef.current = {
              meta: msg,
              chunks: [],
              receivedBytes: 0,
              startTime: Date.now(),
            };

            setTransfers((prev) => [
              {
                id: msg.id,
                name: msg.name,
                size: msg.size,
                progress: 0,
                speed: "Receiving via P2P...",
                status: "transferring",
                mode: "p2p",
              },
              ...prev.filter((t) => t.id !== msg.id),
            ]);
          } else if (msg.type === "file-end") {
            // P2P file complete! Assemble blob instantly in memory!
            const rec = receivingFileRef.current;
            if (rec && rec.meta.id === msg.id) {
              const blob = new Blob(rec.chunks as unknown as BlobPart[], {
                type: rec.meta.mimeType || "application/octet-stream",
              });
              const blobUrl = URL.createObjectURL(blob);

              const item: SharedFileItem = {
                id: rec.meta.id,
                name: rec.meta.name,
                size: rec.meta.size,
                type: rec.meta.mimeType,
                senderName: connectedPeer?.name || "Peer",
                senderId: "remote",
                uploadedAt: Date.now(),
                blobUrl,
              };

              setReceivedFiles((prev) => [item, ...prev]);
              setNewFileAlert(item);
              playChime("received");
              setActiveTab("received");

              setTransfers((prev) =>
                prev.map((t) =>
                  t.id === msg.id
                    ? { ...t, progress: 100, status: "completed", speed: "Received via P2P (Max Speed)" }
                    : t
                )
              );

              // Auto-trigger direct download to phone storage
              const a = document.createElement("a");
              a.href = blobUrl;
              a.download = rec.meta.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);

              receivingFileRef.current = null;
            }
          }
        } catch (e) {}
      } else {
        // Binary ArrayBuffer chunk received over WebRTC SCTP socket!
        const chunk = event.data as ArrayBuffer;
        const rec = receivingFileRef.current;
        if (rec) {
          rec.chunks.push(chunk);
          rec.receivedBytes += chunk.byteLength;

          const progress = Math.min(99, Math.round((rec.receivedBytes / rec.meta.size) * 100));
          const elapsed = (Date.now() - rec.startTime) / 1000;
          const speedMBs = elapsed > 0 ? (rec.receivedBytes / (1024 * 1024) / elapsed).toFixed(1) : "0";

          setTransfers((prev) =>
            prev.map((t) =>
              t.id === rec.meta.id
                ? {
                    ...t,
                    progress,
                    speed: `⚡ ${speedMBs} MB/s (${(rec.receivedBytes / 1024 / 1024).toFixed(1)} / ${(
                      rec.meta.size /
                      1024 /
                      1024
                    ).toFixed(1)} MB)`,
                  }
                : t
            )
          );
        }
      }
    };
  };

  // Create WebRTC PeerConnection
  const createPeerConnection = (targetPeerId: string) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(targetPeerId, "candidate", event.candidate);
      }
    };

    pc.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  // Auto-Negotiate P2P Connection
  const initiateP2P = async (target: Peer) => {
    if (isInitiatingRef.current || isP2PConnected) return;
    isInitiatingRef.current = true;

    try {
      const pc = createPeerConnection(target.id);
      const channel = pc.createDataChannel("file-transfer", {
        ordered: true,
      });
      setupDataChannel(channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(target.id, "offer", offer);
    } catch (e) {
      isInitiatingRef.current = false;
    }
  };

  // Handle incoming signaling messages
  const handleSignalMessage = async (msg: any) => {
    const { from, type, payload } = msg;

    if (type === "offer") {
      const pc = createPeerConnection(from);
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

  // Heartbeat & Signal Polling
  useEffect(() => {
    if (!roomId || !peerId) return;

    let isMounted = true;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/transfer/signal?roomId=${roomId}&peerId=${peerId}&deviceName=${encodeURIComponent(
            deviceName
          )}&deviceType=${deviceType}`
        );
        const data = await res.json();

        if (isMounted && data.success) {
          const others: Peer[] = (data.peers || []).filter((p: Peer) => p.id !== peerId);

          if (others.length > 0) {
            const target = others[0];
            lastSeenPeerTimeRef.current = Date.now();
            setConnectedPeer(target);

            // AUTO-CONNECT WebRTC: Deterministic initiator (smaller peerId starts offer)
            if (!isP2PConnected && !dataChannelRef.current && peerId < target.id) {
              initiateP2P(target);
            }
          } else {
            // Grace period: only drop if no heartbeat for > 8s
            if (Date.now() - lastSeenPeerTimeRef.current > 8000) {
              setConnectedPeer(null);
              setIsP2PConnected(false);
              isInitiatingRef.current = false;
            }
          }

          // Process incoming signals
          if (data.messages && data.messages.length > 0) {
            for (const msg of data.messages) {
              await handleSignalMessage(msg);
            }
          }
        }
      } catch (err) {}
    };

    poll();
    const interval = setInterval(poll, 1200);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [roomId, peerId, deviceName, deviceType, isP2PConnected]);

  // ULTRA FAST DIRECT P2P TRANSFER (Streams raw ArrayBuffer directly over Wi-Fi DataChannel)
  const handleSendFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const transferId = Math.random().toString(36).substring(2, 9);

      const channel = dataChannelRef.current;

      // 1. If WebRTC DataChannel is ready -> BLAZING FAST P2P! (40 - 80 MB/s)
      if (channel && channel.readyState === "open") {
        await streamFileWebRTC(file, transferId, channel);
      } else {
        // Fallback: If WebRTC not ready, try to connect or use LAN route
        if (connectedPeer) {
          initiateP2P(connectedPeer);
        }
        await streamFileLanFallback(file, transferId);
      }
    }
  };

  // High-Speed WebRTC Binary Streamer
  const streamFileWebRTC = async (file: File, transferId: string, channel: RTCDataChannel) => {
    const CHUNK_SIZE = 64 * 1024; // 64 KB optimal SCTP packet size
    channel.bufferedAmountLowThreshold = 2 * 1024 * 1024; // 2 MB low-water mark

    const newItem: TransferringItem = {
      id: transferId,
      name: file.name,
      size: file.size,
      progress: 0,
      speed: "⚡ P2P Direct Stream...",
      status: "transferring",
      mode: "p2p",
    };

    setTransfers((prev) => [newItem, ...prev]);

    // Send metadata header
    channel.send(
      JSON.stringify({
        type: "file-start",
        id: transferId,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      })
    );

    let offset = 0;
    const startTime = Date.now();

    while (offset < file.size) {
      // Flow control: Wait if buffer exceeds 4MB
      if (channel.bufferedAmount > 4 * 1024 * 1024) {
        await new Promise<void>((resolve) => {
          const handler = () => {
            channel.removeEventListener("bufferedamountlow", handler);
            resolve();
          };
          channel.addEventListener("bufferedamountlow", handler);
        });
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const arrayBuffer = await slice.arrayBuffer();
      channel.send(arrayBuffer);

      offset += arrayBuffer.byteLength;

      const progress = Math.min(99, Math.round((offset / file.size) * 100));
      const elapsed = (Date.now() - startTime) / 1000;
      const speedMBs = elapsed > 0 ? (offset / (1024 * 1024) / elapsed).toFixed(1) : "0";

      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? {
                ...t,
                progress,
                speed: `⚡ ${speedMBs} MB/s (${(offset / 1024 / 1024).toFixed(1)} / ${(
                  file.size /
                  1024 /
                  1024
                ).toFixed(1)} MB)`,
              }
            : t
        )
      );
    }

    // Send end signal
    channel.send(
      JSON.stringify({
        type: "file-end",
        id: transferId,
      })
    );

    playChime("sent");

    setTransfers((prev) =>
      prev.map((t) =>
        t.id === transferId
          ? {
              ...t,
              progress: 100,
              status: "completed",
              speed: "⚡ Sent via Direct P2P (Max Speed)",
            }
          : t
      )
    );
  };

  // LAN Fallback Streamer
  const streamFileLanFallback = async (file: File, transferId: string) => {
    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;

    setTransfers((prev) => [
      {
        id: transferId,
        name: file.name,
        size: file.size,
        progress: 0,
        speed: "Connecting...",
        status: "transferring",
        mode: "lan",
      },
      ...prev,
    ]);

    const startTime = Date.now();

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startByte = chunkIndex * CHUNK_SIZE;
      const endByte = Math.min(startByte + CHUNK_SIZE, file.size);
      const chunkBlob = file.slice(startByte, endByte);

      const formData = new FormData();
      formData.append("chunk", chunkBlob);
      formData.append("fileId", transferId);
      formData.append("fileName", file.name);
      formData.append("fileSize", file.size.toString());
      formData.append("mimeType", file.type || "application/octet-stream");
      formData.append("chunkIndex", chunkIndex.toString());
      formData.append("totalChunks", totalChunks.toString());
      formData.append("roomId", roomId);
      formData.append("senderName", deviceName);
      formData.append("senderId", peerId);

      try {
        const res = await fetch("/api/transfer/chunk", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!data.success) throw new Error("Chunk failed");

        const uploadedBytes = endByte;
        const currentPct = Math.min(99, Math.round((uploadedBytes / file.size) * 100));
        const elapsedSec = (Date.now() - startTime) / 1000;
        const speedMBs = elapsedSec > 0 ? (uploadedBytes / (1024 * 1024) / elapsedSec).toFixed(1) : "0";

        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? {
                  ...t,
                  progress: currentPct,
                  speed: `${speedMBs} MB/s (${(uploadedBytes / 1024 / 1024).toFixed(1)} / ${(
                    file.size /
                    1024 /
                    1024
                  ).toFixed(1)} MB)`,
                }
              : t
          )
        );
      } catch (err) {
        break;
      }
    }

    playChime("sent");
    setTransfers((prev) =>
      prev.map((t) =>
        t.id === transferId
          ? {
              ...t,
              progress: 100,
              status: "completed",
              speed: "Sent via Local Wi-Fi",
            }
          : t
      )
    );
  };

  // Send Text Message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const text = chatInput.trim();
    const newMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: deviceName,
      text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, newMsg]);
    setChatInput("");
    playChime("sent");

    // Send via P2P DataChannel if open
    if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
      dataChannelRef.current.send(
        JSON.stringify({
          type: "chat",
          sender: deviceName,
          text,
        })
      );
    } else {
      // Or fallback to signal
      sendSignal("all", "text-message", { sender: deviceName, text });
    }
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl || window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

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
    <div className="min-h-screen bg-slate-950 text-slate-100 pt-20 pb-16 px-4 sm:px-6 lg:px-8 selection:bg-indigo-500 selection:text-white">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* PROMINENT ALERT MODAL: New File Arrived! */}
        {newFileAlert && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="relative w-full max-w-md rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-emerald-500 p-6 shadow-2xl text-center space-y-5">
              <button
                onClick={() => setNewFileAlert(null)}
                className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto shadow-lg animate-bounce">
                <BellRing className="w-8 h-8" />
              </div>

              <div>
                <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 inline-block mb-2">
                  ⚡ Received at Max Wi-Fi Speed!
                </span>
                <h3 className="text-xl font-bold text-white break-all">
                  {newFileAlert.name}
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                  From: <strong className="text-indigo-400">{newFileAlert.senderName}</strong> • {formatBytes(newFileAlert.size)}
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <a
                  href={newFileAlert.blobUrl || newFileAlert.downloadUrl}
                  download={newFileAlert.name}
                  onClick={() => setNewFileAlert(null)}
                  className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
                >
                  <Download className="w-5 h-5" />
                  Save / Download to Device
                </a>
                <button
                  onClick={() => setNewFileAlert(null)}
                  className="w-full py-2.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CONNECTION STATUS HEADER BAR */}
        <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 md:p-6 shadow-xl backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            
            {/* Devices Connection Pill */}
            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* This Device */}
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-800 border border-slate-700">
                <div className="text-indigo-400">
                  {getDeviceIcon(deviceType, "w-5 h-5")}
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">You</span>
                  <span className="text-xs font-semibold text-white truncate max-w-[120px] block">
                    {deviceName}
                  </span>
                </div>
              </div>

              {/* Status Arrow */}
              <div className="flex flex-col items-center">
                <ArrowRightLeft className={`w-4 h-4 ${connectedPeer ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
              </div>

              {/* Connected Device */}
              <div
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border transition-all duration-300 ${
                  connectedPeer
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                    : "bg-slate-800/50 border-slate-700/50 text-slate-500"
                }`}
              >
                <div>
                  {connectedPeer ? getDeviceIcon(connectedPeer.deviceType, "w-5 h-5 text-emerald-400") : <Wifi className="w-5 h-5" />}
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold block flex items-center gap-1">
                    {connectedPeer ? "Connected" : "Waiting"}
                    {isP2PConnected && (
                      <span className="text-amber-400 font-extrabold flex items-center">
                        <Zap className="w-3 h-3 fill-amber-400" /> P2P Turbo
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-semibold truncate max-w-[130px] block text-white">
                    {connectedPeer ? connectedPeer.name : "Scan QR to Pair"}
                  </span>
                </div>
              </div>
            </div>

            {/* QR Code Action Button */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                onClick={() => setShowQrModal(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition-all active:scale-95"
              >
                <QrCode className="w-4 h-4" />
                Scan Phone QR
              </button>

              <button
                onClick={copyShareLink}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                title="Copy Link"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Speed Indicator Banner */}
          {isP2PConnected && (
            <div className="mt-4 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400 fill-emerald-400 animate-pulse" />
                <span>
                  <strong>Direct WebRTC P2P Active:</strong> Files transfer directly device-to-device at full Wi-Fi speed (30–80+ MB/s).
                </span>
              </div>
            </div>
          )}

          {!connectedPeer && (
            <div className="mt-4 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                <span>Phone ko Mac se connect karne ke liye <strong>QR Code scan karein</strong>.</span>
              </div>
              <button onClick={() => setShowQrModal(true)} className="underline font-semibold text-white ml-2">
                Open QR
              </button>
            </div>
          )}
        </div>

        {/* 3 CLEAN TABS: Send Files / Received Files / Quick Text */}
        <div className="flex rounded-2xl bg-slate-900 p-1.5 border border-slate-800">
          <button
            onClick={() => setActiveTab("send")}
            className={`flex-1 py-3 text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all ${
              activeTab === "send"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FolderUp className="w-4 h-4" />
            📤 Send Files to {connectedPeer ? connectedPeer.name : "Device"}
          </button>

          <button
            onClick={() => setActiveTab("received")}
            className={`flex-1 py-3 text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all relative ${
              activeTab === "received"
                ? "bg-emerald-600 text-white shadow-lg"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Download className="w-4 h-4" />
            📥 Received Files ({receivedFiles.length})
            {receivedFiles.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
            )}
          </button>

          <button
            onClick={() => setActiveTab("chat")}
            className={`flex-1 py-3 text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all ${
              activeTab === "chat"
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            💬 Text / Links ({messages.length})
          </button>
        </div>

        {/* TAB 1: SEND FILES */}
        {activeTab === "send" && (
          <div className="space-y-6">
            
            {/* BIG FILE DROP / PICKER CARD */}
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
              className={`cursor-pointer border-2 border-dashed rounded-3xl p-10 text-center transition-all duration-200 ${
                dragOver
                  ? "border-emerald-400 bg-emerald-500/10 scale-[1.01]"
                  : "border-slate-700 bg-slate-900/80 hover:border-indigo-400 hover:bg-slate-900"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleSendFiles(e.target.files)}
              />
              <div className="w-20 h-20 rounded-3xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center mx-auto mb-4 shadow-xl">
                <FolderUp className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-white flex items-center justify-center gap-2">
                Tap here to Select Files or Drop them here
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-2">
                Send Photos, Videos, PDFs, APKs, or Folders to <strong className="text-indigo-400">{connectedPeer ? connectedPeer.name : "Connected Device"}</strong>
              </p>
              
              <div className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-600/30">
                <FolderUp className="w-4 h-4" />
                Select from Device
              </div>
            </div>

            {/* LIVE OUTGOING & INCOMING TRANSFERS */}
            {transfers.length > 0 && (
              <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Live Transfer Queue
                </h3>
                <div className="space-y-3">
                  {transfers.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl bg-slate-800/60 border border-slate-700 p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white truncate max-w-[240px]">
                          {item.name}
                        </span>
                        <span className="text-indigo-400 font-bold">{item.progress}%</span>
                      </div>

                      <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-200 ${
                            item.status === "completed"
                              ? "bg-emerald-400"
                              : item.status === "error"
                              ? "bg-rose-500"
                              : "bg-gradient-to-r from-indigo-500 to-amber-400"
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{formatBytes(item.size)}</span>
                        <span className={`font-semibold ${item.status === "completed" ? "text-emerald-400" : "text-amber-300"}`}>
                          {item.speed}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RECEIVED FILES */}
        {activeTab === "received" && (
          <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Download className="w-5 h-5 text-emerald-400" />
                  Files Received on this Device
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Click Save/Download to keep files on your phone or computer.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {receivedFiles.length} File{receivedFiles.length === 1 ? "" : "s"}
              </span>
            </div>

            {receivedFiles.length === 0 ? (
              <div className="text-center py-12 text-slate-500 space-y-3">
                <FileText className="w-12 h-12 mx-auto opacity-30 text-slate-400" />
                <p className="text-sm font-medium">No files received yet</p>
                <p className="text-xs text-slate-600 max-w-sm mx-auto">
                  Jab doosra device koi file bhejega, toh wo yahan automatic direct P2P aayegi aur download ho jayegi.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {receivedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80 hover:border-emerald-500/40 transition-all"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                        <FileCheck className="w-5 h-5" />
                      </div>
                      <div className="truncate">
                        <p className="font-semibold text-sm text-white truncate">{file.name}</p>
                        <p className="text-xs text-slate-400">
                          {formatBytes(file.size)} • From {file.senderName}
                        </p>
                      </div>
                    </div>

                    <a
                      href={file.blobUrl || file.downloadUrl}
                      download={file.name}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shrink-0 shadow-md transition-all active:scale-95"
                    >
                      <Download className="w-4 h-4" /> Download / Save
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TEXT & CLIPBOARD */}
        {activeTab === "chat" && (
          <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 flex flex-col h-[460px] space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
              <span className="font-bold text-white">Instant Text & Clipboard Sharing</span>
              <span className="text-slate-400">Syncs between Mac & Phone</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 space-y-2">
                  <MessageSquare className="w-8 h-8 opacity-30" />
                  <p>Send URLs, verification codes, or text snippets between devices instantly.</p>
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
                          className="mt-1.5 text-[10px] opacity-75 hover:opacity-100 flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copy
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleSendMessage} className="flex gap-2 pt-2 border-t border-slate-800">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Paste link or type message..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            </form>
          </div>
        )}

      </div>

      {/* QR MODAL */}
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
              Phone camera ya Google Lens se scan karein aur direct connect karein.
            </p>

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

            <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-800 border border-slate-700 text-left">
              <span className="text-[11px] text-slate-300 truncate flex-1 font-mono">
                {shareUrl}
              </span>
              <button
                onClick={copyShareLink}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <p className="text-[11px] text-slate-500">
              Room: <strong className="text-slate-300">#{roomId}</strong> • IP: {localIp}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
