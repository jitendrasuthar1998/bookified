import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

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

        const uploadDir = path.join(process.cwd(), "public", "uploads");
        if (!existsSync(uploadDir)) {
            await fs.mkdir(uploadDir, { recursive: true });
        }

        // Clean filename and add timestamp suffix to avoid collisions
        const originalName = customName || file.name || "upload";
        const ext = path.extname(originalName) || (file.type.includes("pdf") ? ".pdf" : ".png");
        const baseName = path.basename(originalName, ext).replace(/[^\w-]/g, "_");
        const uniqueFileName = `${baseName}_${Date.now()}${ext}`;

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
        console.error("Local file upload error:", e);
        return NextResponse.json(
            { error: "Upload failed. Please try again." },
            { status: 500 }
        );
    }
}
