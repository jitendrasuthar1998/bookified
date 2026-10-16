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
  Zap,
  ArrowRightLeft,
  BellRing,
  FileText,
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

  // Connected Peers
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connectedPeer, setConnectedPeer] = useState<Peer | null>(null);

  // Files
  const [sendingQueue, setSendingQueue] = useState<TransferringItem[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<SharedFileItem[]>([]);
  const [knownFileIds, setKnownFileIds] = useState<Set<string>>(new Set());
  const [newFileAlert, setNewFileAlert] = useState<SharedFileItem | null>(null);

  // Text / Chat
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

  // Heartbeat & Signal Polling
  useEffect(() => {
    if (!roomId || !peerId) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        // 1. Presence / Signal poll
        const res = await fetch(
          `/api/transfer/signal?roomId=${roomId}&peerId=${peerId}&deviceName=${encodeURIComponent(
            deviceName
          )}&deviceType=${deviceType}`
        );
        const data = await res.json();

        if (isMounted && data.success) {
          const others: Peer[] = (data.peers || []).filter((p: Peer) => p.id !== peerId);
          setPeers(others);
          if (others.length > 0) {
            setConnectedPeer(others[0]);
          } else {
            setConnectedPeer(null);
          }

          // Handle incoming text chat
          if (data.messages && data.messages.length > 0) {
            for (const msg of data.messages) {
              if (msg.type === "text-message") {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: msg.id,
                    sender: msg.payload.sender,
                    text: msg.payload.text,
                    timestamp: msg.timestamp,
                  },
                ]);
                playChime("received");
              }
            }
          }
        }

        // 2. Poll for shared files in room
        const fileRes = await fetch(`/api/transfer/fallback?roomId=${roomId}`);
        const fileData = await fileRes.json();

        if (isMounted && fileData.success && Array.isArray(fileData.files)) {
          const incomingFiles: SharedFileItem[] = [];

          for (const item of fileData.files) {
            const dlUrl = `/api/transfer/fallback?roomId=${roomId}&fileId=${item.id}`;
            const fileItem: SharedFileItem = {
              ...item,
              downloadUrl: dlUrl,
            };

            // If file was sent by the other device and we haven't seen it yet
            if (item.senderId !== peerId && !knownFileIds.has(item.id)) {
              setKnownFileIds((prev) => new Set(prev).add(item.id));
              setNewFileAlert(fileItem);
              playChime("received");

              // Auto switch to received tab on mobile
              setActiveTab("received");

              // Trigger auto download if desired
              const a = document.createElement("a");
              a.href = dlUrl;
              a.download = item.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }

            incomingFiles.push(fileItem);
          }

          // Update received files list (files sent by others)
          const receivedOnly = incomingFiles.filter((f) => f.senderId !== peerId);
          setReceivedFiles(receivedOnly);
        }
      } catch (err) {}
    }, 1500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [roomId, peerId, deviceName, deviceType, knownFileIds]);

  // Send File Handler
  const handleSendFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const transferId = Math.random().toString(36).substring(2, 9);

      const newItem: TransferringItem = {
        id: transferId,
        name: file.name,
        size: file.size,
        progress: 10,
        speed: "Starting...",
        status: "transferring",
      };

      setSendingQueue((prev) => [newItem, ...prev]);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("roomId", roomId);
        formData.append("senderName", deviceName);
        formData.append("senderId", peerId);

        setSendingQueue((prev) =>
          prev.map((t) => (t.id === transferId ? { ...t, progress: 45, speed: "Uploading to Local Wi-Fi..." } : t))
        );

        const res = await fetch("/api/transfer/fallback", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (data.success) {
          setSendingQueue((prev) =>
            prev.map((t) =>
              t.id === transferId
                ? { ...t, progress: 100, status: "completed", speed: "Sent to " + (connectedPeer?.name || "Device") }
                : t
            )
          );
          playChime("sent");

          // Also mark our own file id as known so we don't alert ourselves
          if (data.file?.id) {
            setKnownFileIds((prev) => new Set(prev).add(data.file.id));
          }
        } else {
          throw new Error("Upload failed");
        }
      } catch (err) {
        setSendingQueue((prev) =>
          prev.map((t) => (t.id === transferId ? { ...t, status: "error", speed: "Failed" } : t))
        );
      }
    }
  };

  // Send Text Message
  const handleSendMessage = async (e: React.FormEvent) => {
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

    try {
      await fetch("/api/transfer/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          from: peerId,
          to: "all",
          type: "text-message",
          payload: {
            sender: deviceName,
            text,
          },
        }),
      });
    } catch (e) {}
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
                  File Received!
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
                  href={newFileAlert.downloadUrl}
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
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border transition-all ${
                  connectedPeer
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                    : "bg-slate-800/50 border-slate-700/50 text-slate-500"
                }`}
              >
                <div>
                  {connectedPeer ? getDeviceIcon(connectedPeer.deviceType, "w-5 h-5 text-emerald-400") : <Wifi className="w-5 h-5" />}
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold block">
                    {connectedPeer ? "Connected" : "Waiting"}
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
            📤 Send Files to {connectedPeer ? connectedPeer.name : "Other Device"}
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
              <h2 className="text-xl font-bold text-white">
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

            {/* LIVE OUTGOING TRANSFERS */}
            {sendingQueue.length > 0 && (
              <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Outgoing Transfers
                </h3>
                <div className="space-y-3">
                  {sendingQueue.map((item) => (
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

                      <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-indigo-500 h-full rounded-full transition-all duration-200"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{formatBytes(item.size)}</span>
                        <span className="font-medium text-emerald-400">{item.speed}</span>
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
                  Jab doosra device koi file bhejega, toh wo yahan automatic aayegi aur download ho jayegi.
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
                      href={file.downloadUrl}
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
