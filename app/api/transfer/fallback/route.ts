import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface SharedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  data: Uint8Array;
  senderName: string;
  senderId: string;
  uploadedAt: number;
}

// Temporary in-memory file repository for the LAN session
const globalFiles: Map<string, SharedFile[]> = (globalThis as any).__transferFiles || new Map();
(globalThis as any).__transferFiles = globalFiles;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const roomId = (formData.get("roomId") as string) || "default";
    const senderName = (formData.get("senderName") as string) || "Anonymous";
    const senderId = (formData.get("senderId") as string) || "anonymous";

    if (!file) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const fileRecord: SharedFile = {
      id: Math.random().toString(36).substring(2, 12),
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      data: buffer,
      senderName,
      senderId,
      uploadedAt: Date.now(),
    };

    if (!globalFiles.has(roomId)) {
      globalFiles.set(roomId, []);
    }
    const roomFileList = globalFiles.get(roomId)!;
    roomFileList.push(fileRecord);

    // Keep only last 10 files per room to avoid memory leak
    if (roomFileList.length > 10) {
      roomFileList.shift();
    }

    return NextResponse.json({
      success: true,
      file: {
        id: fileRecord.id,
        name: fileRecord.name,
        size: fileRecord.size,
        type: fileRecord.type,
        senderName: fileRecord.senderName,
        uploadedAt: fileRecord.uploadedAt,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "File upload failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId") || "default";
  const fileId = searchParams.get("fileId");

  const roomFileList = globalFiles.get(roomId) || [];

  // Download a specific file
  if (fileId) {
    const found = roomFileList.find((f) => f.id === fileId);
    if (!found) {
      return new NextResponse("File not found", { status: 404 });
    }

    return new NextResponse(new Blob([found.data as unknown as BlobPart]), {
      headers: {
        "Content-Type": found.type,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(found.name)}"`,
        "Content-Length": found.size.toString(),
      },
    });
  }

  // Otherwise list available files
  const list = roomFileList.map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    type: f.type,
    senderName: f.senderName,
    senderId: f.senderId,
    uploadedAt: f.uploadedAt,
  }));

  return NextResponse.json({ success: true, files: list });
}
