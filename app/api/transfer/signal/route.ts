import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface Peer {
  id: string;
  name: string;
  deviceType: "mac" | "android" | "windows" | "ios" | "unknown";
  lastSeen: number;
}

interface SignalMessage {
  id: string;
  from: string;
  to: string;
  type: "offer" | "answer" | "candidate" | "text-message" | "ping";
  payload: any;
  timestamp: number;
}

interface RoomData {
  peers: Map<string, Peer>;
  messages: SignalMessage[];
}

// Global in-memory storage for rooms during the Next.js process lifetime
const globalRooms: Map<string, RoomData> = (globalThis as any).__transferRooms || new Map();
(globalThis as any).__transferRooms = globalRooms;

function getOrCreateRoom(roomId: string): RoomData {
  if (!globalRooms.has(roomId)) {
    globalRooms.set(roomId, {
      peers: new Map(),
      messages: [],
    });
  }
  return globalRooms.get(roomId)!;
}

// Clean up stale peers and old messages
function cleanupRoom(room: RoomData) {
  const now = Date.now();
  // Remove peers inactive for > 25 seconds
  for (const [peerId, peer] of room.peers.entries()) {
    if (now - peer.lastSeen > 25000) {
      room.peers.delete(peerId);
    }
  }
  // Keep only messages from last 60 seconds and maximum 100 messages
  room.messages = room.messages.filter((m) => now - m.timestamp < 60000).slice(-100);
}

// GET: Poll for room state, active peers, and incoming messages
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId") || "default";
  const peerId = searchParams.get("peerId");
  const deviceName = searchParams.get("deviceName") || "Unknown Device";
  const deviceType = (searchParams.get("deviceType") as any) || "unknown";

  const room = getOrCreateRoom(roomId);
  cleanupRoom(room);

  if (peerId) {
    // Heartbeat
    room.peers.set(peerId, {
      id: peerId,
      name: deviceName,
      deviceType,
      lastSeen: Date.now(),
    });
  }

  // Get messages destined for this peer (or broadcast "all") that haven't been consumed
  let pendingMessages: SignalMessage[] = [];
  if (peerId) {
    pendingMessages = room.messages.filter((m) => m.to === peerId && m.from !== peerId);
    // Remove retrieved messages for this peer so they aren't delivered repeatedly
    room.messages = room.messages.filter((m) => !(m.to === peerId && m.from !== peerId));
  }

  const peersList = Array.from(room.peers.values());

  return NextResponse.json({
    success: true,
    peers: peersList,
    messages: pendingMessages,
  });
}

// POST: Send an SDP offer, answer, ICE candidate, or signal message
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId = "default", from, to, type, payload } = body;

    if (!from || !to || !type) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: from, to, type" },
        { status: 400 }
      );
    }

    const room = getOrCreateRoom(roomId);
    cleanupRoom(room);

    const message: SignalMessage = {
      id: Math.random().toString(36).substring(2, 10),
      from,
      to,
      type,
      payload,
      timestamp: Date.now(),
    };

    room.messages.push(message);

    return NextResponse.json({ success: true, messageId: message.id });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Signal post failed" },
      { status: 500 }
    );
  }
}
