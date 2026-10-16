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

interface SharedFileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  senderName: string;
  blobUrl: string;
  receivedAt: number;
}

interface TransferringItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  speed: string;
  status: "transferring" | "completed" | "error";
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export default function TransferPage() {
  // Device identity
  const [deviceName, setDeviceName] = useState<string>("My Device");
  const [deviceType, setDeviceType] = useState<"mac" | "android" | "windows" | "ios" | "unknown">("unknown");
  const [myPeerId, setMyPeerId] = useState<string>("");

  // Room state
  const [roomId, setRoomId] = useState<string>("room123");
  const [shareUrl, setShareUrl] = useState<string>("");
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Connection State (100% P2P WebRTC via PeerJS, ZERO HTTP FETCH CALLS)
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [remoteDeviceName, setRemoteDeviceName] = useState<string>("Other Device");
  const [remoteDeviceType, setRemoteDeviceType] = useState<string>("unknown");

  // PeerJS instances
  const peerInstanceRef = useRef<any>(null);
  const connectionRef = useRef<any>(null);

  // In-memory Receiving Buffer
  const receivingFileRef = useRef<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    chunks: ArrayBuffer[];
    receivedBytes: number;
    startTime: number;
  } | null>(null);

  // Transfers & Files
  const [transfers, setTransfers] = useState<TransferringItem[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<SharedFileItem[]>([]);
  const [newFileAlert, setNewFileAlert] = useState<SharedFileItem | null>(null);

  // Text Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"send" | "received" | "chat">("send");

  // Drag over
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

  // 1. Detect User Agent
  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = navigator.userAgent;
    let detectedType: "mac" | "android" | "windows" | "ios" | "unknown" = "unknown";
    let defaultName = "Device";

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
  }, []);

  // 2. Initialize PeerJS WebRTC P2P Connection (No HTTP Polling)
  useEffect(() => {
    if (typeof window === "undefined") return;

    let destroyed = false;

    async function initPeerJS() {
      const PeerModule = (await import("peerjs")).default;

      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get("room") || Math.floor(1000 + Math.random() * 9000).toString();
      const targetJoinId = params.get("join");
      setRoomId(urlRoom);

      // Generate clean unique Peer ID for this room session
      const myId = `bf-${urlRoom}-${Math.random().toString(36).substring(2, 7)}`;
      setMyPeerId(myId);

      // URL to share via QR
      const origin = window.location.origin;
      const fullShareUrl = `${origin}/transfer?room=${urlRoom}&join=${myId}`;
      setShareUrl(fullShareUrl);
      generateQrCodeDataUrl(fullShareUrl).then(setQrCodeUrl);

      // Create Peer instance with STUN servers
      const peer = new PeerModule(myId, {
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
          ],
        },
      });

      peerInstanceRef.current = peer;

      // When peer is ready
      peer.on("open", (id) => {
        // If there's a join target in the URL (e.g. Android scanning Mac's QR)
        if (targetJoinId && targetJoinId !== id) {
          const conn = peer.connect(targetJoinId, {
            reliable: true,
          });
          setupConnection(conn);
        }
      });

      // When incoming P2P connection arrives (e.g. Mac receiving connection from Phone)
      peer.on("connection", (conn) => {
        setupConnection(conn);
      });

      peer.on("error", (err) => {
        console.warn("PeerJS notice:", err);
      });
    }

    // Bind event handlers to the established P2P connection
    function setupConnection(conn: any) {
      connectionRef.current = conn;

      conn.on("open", () => {
        setIsConnected(true);

        // Exchange handshake greeting
        conn.send({
          type: "handshake",
          deviceName,
          deviceType,
        });
      });

      conn.on("close", () => {
        setIsConnected(false);
        connectionRef.current = null;
      });

      conn.on("data", (data: any) => {
        handleIncomingP2PData(data, conn);
      });
    }

    // Handle high-speed P2P data packets (zero server intervention)
    function handleIncomingP2PData(data: any, conn: any) {
      // 1. Binary ArrayBuffer chunk (The actual file data!)
      if (data instanceof ArrayBuffer) {
        const rec = receivingFileRef.current;
        if (rec) {
          rec.chunks.push(data);
          rec.receivedBytes += data.byteLength;

          const progress = Math.min(99, Math.round((rec.receivedBytes / rec.size) * 100));
          const elapsed = (Date.now() - rec.startTime) / 1000;
          const speedMBs = elapsed > 0 ? (rec.receivedBytes / (1024 * 1024) / elapsed).toFixed(1) : "0";

          setTransfers((prev) =>
            prev.map((t) =>
              t.id === rec.id
                ? {
                    ...t,
                    progress,
                    speed: `⚡ ${speedMBs} MB/s (${(rec.receivedBytes / 1024 / 1024).toFixed(1)} / ${(
                      rec.size /
                      1024 /
                      1024
                    ).toFixed(1)} MB)`,
                  }
                : t
            )
          );
        }
        return;
      }

      // 2. JSON control messages
      if (typeof data === "object") {
        if (data.type === "handshake") {
          setRemoteDeviceName(data.deviceName || "Device");
          setRemoteDeviceType(data.deviceType || "unknown");
          // Reply with our identity if not sent yet
          conn.send({
            type: "handshake-reply",
            deviceName,
            deviceType,
          });
        } else if (data.type === "handshake-reply") {
          setRemoteDeviceName(data.deviceName || "Device");
          setRemoteDeviceType(data.deviceType || "unknown");
        } else if (data.type === "chat") {
          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(),
              sender: data.sender,
              text: data.text,
              timestamp: Date.now(),
            },
          ]);
          playChime("received");
        } else if (data.type === "file-start") {
          // Initialize in-memory receiver
          receivingFileRef.current = {
            id: data.id,
            name: data.name,
            size: data.size,
            mimeType: data.mimeType || "application/octet-stream",
            chunks: [],
            receivedBytes: 0,
            startTime: Date.now(),
          };

          setTransfers((prev) => [
            {
              id: data.id,
              name: data.name,
              size: data.size,
              progress: 0,
              speed: "⚡ P2P Direct Stream...",
              status: "transferring",
            },
            ...prev.filter((t) => t.id !== data.id),
          ]);
        } else if (data.type === "file-end") {
          const rec = receivingFileRef.current;
          if (rec && rec.id === data.id) {
            const blob = new Blob(rec.chunks as unknown as BlobPart[], {
              type: rec.mimeType,
            });
            const blobUrl = URL.createObjectURL(blob);

            const fileItem: SharedFileItem = {
              id: rec.id,
              name: rec.name,
              size: rec.size,
              type: rec.mimeType,
              senderName: remoteDeviceName,
              blobUrl,
              receivedAt: Date.now(),
            };

            setReceivedFiles((prev) => [fileItem, ...prev]);
            setNewFileAlert(fileItem);
            playChime("received");
            setActiveTab("received");

            setTransfers((prev) =>
              prev.map((t) =>
                t.id === data.id
                  ? { ...t, progress: 100, status: "completed", speed: "⚡ Received at Max Wi-Fi Speed" }
                  : t
              )
            );

            // Trigger direct download to device
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = rec.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            receivingFileRef.current = null;
          }
        }
      }
    }

    initPeerJS();

    return () => {
      destroyed = true;
      if (peerInstanceRef.current) {
        peerInstanceRef.current.destroy();
      }
    };
  }, [deviceName, deviceType]);

  // HIGH-SPEED DIRECT P2P TRANSFER (NO HTTP FETCH CALLS)
  const handleSendFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    const conn = connectionRef.current;
    if (!conn || !conn.open) {
      alert("Please connect with the phone first by scanning the QR code!");
      return;
    }

    const CHUNK_SIZE = 64 * 1024; // 64 KB native SCTP socket chunk size

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const transferId = Math.random().toString(36).substring(2, 9);

      const newItem: TransferringItem = {
        id: transferId,
        name: file.name,
        size: file.size,
        progress: 0,
        speed: "⚡ P2P Direct Stream...",
        status: "transferring",
      };

      setTransfers((prev) => [newItem, ...prev]);

      // 1. Send file metadata header
      conn.send({
        type: "file-start",
        id: transferId,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      });

      let offset = 0;
      const startTime = Date.now();

      // Access internal raw DataChannel for zero-latency buffer checking
      const dc = conn.dataChannel as RTCDataChannel;
      if (dc) {
        dc.bufferedAmountLowThreshold = 2 * 1024 * 1024; // 2MB
      }

      while (offset < file.size) {
        // High-water mark flow control
        if (dc && dc.bufferedAmount > 4 * 1024 * 1024) {
          await new Promise<void>((resolve) => {
            const onLow = () => {
              dc.removeEventListener("bufferedamountlow", onLow);
              resolve();
            };
            dc.addEventListener("bufferedamountlow", onLow);
          });
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await slice.arrayBuffer();

        // Send raw binary ArrayBuffer straight through WebRTC P2P DataChannel!
        conn.send(arrayBuffer);
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

      // 2. Notify receiver file is finished
      conn.send({
        type: "file-end",
        id: transferId,
      });

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
    }
  };

  // Send Text Message over P2P DataChannel
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

    const conn = connectionRef.current;
    if (conn && conn.open) {
      conn.send({
        type: "chat",
        sender: deviceName,
        text,
      });
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
                  href={newFileAlert.blobUrl}
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
                <ArrowRightLeft className={`w-4 h-4 ${isConnected ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
              </div>

              {/* Connected Device */}
              <div
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border transition-all duration-300 ${
                  isConnected
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-md shadow-emerald-500/10"
                    : "bg-slate-800/50 border-slate-700/50 text-slate-500"
                }`}
              >
                <div>
                  {isConnected ? getDeviceIcon(remoteDeviceType, "w-5 h-5 text-emerald-400") : <Wifi className="w-5 h-5" />}
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold block flex items-center gap-1">
                    {isConnected ? "Connected" : "Waiting"}
                    {isConnected && (
                      <span className="text-amber-400 font-extrabold flex items-center ml-1">
                        <Zap className="w-3 h-3 fill-amber-400" /> P2P Turbo
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-semibold truncate max-w-[130px] block text-white">
                    {isConnected ? remoteDeviceName : "Scan QR to Pair"}
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
          {isConnected ? (
            <div className="mt-4 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400 fill-emerald-400 animate-pulse" />
                <span>
                  <strong>Direct WebRTC P2P Active:</strong> Zero server latency, zero API calls. Data transfers directly device-to-device at full Wi-Fi speed (30–80+ MB/s).
                </span>
              </div>
            </div>
          ) : (
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
            📤 Send Files to {isConnected ? remoteDeviceName : "Device"}
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
                Send Photos, Videos, PDFs, APKs, or Folders to <strong className="text-indigo-400">{isConnected ? remoteDeviceName : "Connected Device"}</strong>
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
                      href={file.blobUrl}
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
              <span className="text-slate-400">Syncs directly between Mac & Phone</span>
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
              Room: <strong className="text-slate-300">#{roomId}</strong>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
