import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { put } from "@vercel/blob";

export async function POST(request: Request): Promise<NextResponse> {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized: User not authenticated" }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const customName = formData.get("filename") as string | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const originalName = customName || file.name || "upload";
        const ext = path.extname(originalName) || (file.type.includes("pdf") ? ".pdf" : ".png");
        const baseName = path.basename(originalName, ext).replace(/[^\w-]/g, "_");
        const uniqueFileName = `${baseName}_${Date.now()}${ext}`;

        const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

        // 1. If Vercel Blob token is configured, upload to Vercel Blob (works on Vercel serverless)
        if (blobToken) {
            try {
                let fileUrl = "";
                try {
                    // Try public store first
                    const blob = await put(uniqueFileName, buffer, {
                        access: "public",
                        token: blobToken,
                        contentType: file.type,
                    });
                    fileUrl = blob.url;
                } catch (publicErr: any) {
                    if (publicErr?.message?.includes("private store")) {
                        // If user configured a private store, upload with private access and proxy URL
                        const privateBlob = await put(uniqueFileName, buffer, {
                            access: "private",
                            token: blobToken,
                            contentType: file.type,
                        });
                        fileUrl = `/api/blob-proxy?url=${encodeURIComponent(privateBlob.url)}`;
                    } else {
                        throw publicErr;
                    }
                }

                return NextResponse.json({
                    url: fileUrl,
                    pathname: uniqueFileName,
                    contentType: file.type,
                    size: file.size,
                });
            } catch (blobError) {
                console.error("Vercel Blob upload failed:", blobError);
                if (process.env.VERCEL) {
                    return NextResponse.json(
                        { error: "Blob storage upload failed on Vercel." },
                        { status: 500 }
                    );
                }
            }
        }

        // 2. Local fallback for local development if no Blob token provided
        const uploadDir = path.join(process.cwd(), "public", "uploads");
        if (!existsSync(uploadDir)) {
            await fs.mkdir(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, uniqueFileName);
        await fs.writeFile(filePath, buffer);

        const url = `/uploads/${uniqueFileName}`;

        return NextResponse.json({
            url,
            pathname: uniqueFileName,
            contentType: file.type,
            size: file.size,
        });
    } catch (e) {
        console.error("File upload error:", e);
        return NextResponse.json(
            { error: "Upload failed. Please try again." },
            { status: 500 }
        );
    }
}
