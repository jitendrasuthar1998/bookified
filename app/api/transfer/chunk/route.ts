import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";

// Directory to store transferred files temporarily
const TEMP_DIR = path.join(os.tmpdir(), "bookified_transfers");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

interface StoredFileMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  filePath: string;
  senderName: string;
  senderId: string;
  roomId: string;
  uploadedAt: number;
}

// In-memory catalog of ready files
const fileCatalog: Map<string, StoredFileMeta> = (globalThis as any).__transferCatalog || new Map();
(globalThis as any).__transferCatalog = fileCatalog;

// POST: Upload a chunk
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const chunk = formData.get("chunk") as File | null;
    const fileId = formData.get("fileId") as string;
    const fileName = formData.get("fileName") as string;
    const fileSize = parseInt(formData.get("fileSize") as string, 10);
    const mimeType = (formData.get("mimeType") as string) || "application/octet-stream";
    const chunkIndex = parseInt(formData.get("chunkIndex") as string, 10);
    const totalChunks = parseInt(formData.get("totalChunks") as string, 10);
    const roomId = (formData.get("roomId") as string) || "default";
    const senderName = (formData.get("senderName") as string) || "Anonymous";
    const senderId = (formData.get("senderId") as string) || "anonymous";

    if (!chunk || !fileId) {
      return NextResponse.json({ success: false, error: "Missing chunk or fileId" }, { status: 400 });
    }

    const chunkBuffer = Buffer.from(await chunk.arrayBuffer());
    const finalFilePath = path.join(TEMP_DIR, `${fileId}_${path.basename(fileName)}`);

    // If chunk 0, initialize file (truncate)
    if (chunkIndex === 0) {
      fs.writeFileSync(finalFilePath, chunkBuffer);
    } else {
      // Append chunk
      fs.appendFileSync(finalFilePath, chunkBuffer);
    }

    const isComplete = chunkIndex + 1 >= totalChunks;

    if (isComplete) {
      const meta: StoredFileMeta = {
        id: fileId,
        name: fileName,
        size: fileSize,
        mimeType,
        filePath: finalFilePath,
        senderName,
        senderId,
        roomId,
        uploadedAt: Date.now(),
      };
      fileCatalog.set(fileId, meta);
    }

    return NextResponse.json({
      success: true,
      chunkIndex,
      isComplete,
      fileId,
    });
  } catch (error: any) {
    console.error("Chunk upload error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to write chunk" },
      { status: 500 }
    );
  }
}

// GET: List files in room OR download a completed file
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId") || "default";
  const fileId = searchParams.get("fileId");

  // 1. Download specific file
  if (fileId) {
    const meta = fileCatalog.get(fileId);
    if (!meta || !fs.existsSync(meta.filePath)) {
      return new NextResponse("File not found", { status: 404 });
    }

    const stat = fs.statSync(meta.filePath);
    const fileStream = fs.createReadStream(meta.filePath);

    // Convert node stream to web readable stream for App Router
    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on("data", (chunk) => controller.enqueue(chunk));
        fileStream.on("end", () => controller.close());
        fileStream.on("error", (err) => controller.error(err));
      },
    });

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": meta.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(meta.name)}"`,
        "Content-Length": stat.size.toString(),
      },
    });
  }

  // 2. List all completed files for this room
  const list: any[] = [];
  for (const meta of fileCatalog.values()) {
    if (meta.roomId === roomId && fs.existsSync(meta.filePath)) {
      list.push({
        id: meta.id,
        name: meta.name,
        size: meta.size,
        type: meta.mimeType,
        senderName: meta.senderName,
        senderId: meta.senderId,
        uploadedAt: meta.uploadedAt,
      });
    }
  }

  // Sort newest first
  list.sort((a, b) => b.uploadedAt - a.uploadedAt);

  return NextResponse.json({ success: true, files: list });
}
