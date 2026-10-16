import { NextResponse } from "next/server";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const fileUrl = searchParams.get("url");

        if (!fileUrl) {
            return new NextResponse("Missing url parameter", { status: 400 });
        }

        // Only allow proxying Vercel Blob URLs for security
        const parsed = new URL(fileUrl);
        if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) {
            return new NextResponse("Unauthorized proxy host", { status: 403 });
        }

        const token = process.env.BLOB_READ_WRITE_TOKEN;
        const headers: Record<string, string> = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const upstream = await fetch(fileUrl, { headers });

        if (!upstream.ok) {
            return new NextResponse(`Failed to fetch file: ${upstream.status}`, {
                status: upstream.status,
            });
        }

        const contentType = upstream.headers.get("content-type") || "application/octet-stream";
        const contentDisposition = upstream.headers.get("content-disposition") || "inline";

        return new NextResponse(upstream.body, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": contentDisposition,
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        });
    } catch (e: any) {
        console.error("Blob proxy error:", e);
        return new NextResponse("Error proxying file", { status: 500 });
    }
}
