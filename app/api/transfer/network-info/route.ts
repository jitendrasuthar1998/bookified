import { NextResponse } from "next/server";
import os from "node:os";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const interfaces = os.networkInterfaces();
    const ips: { name: string; ip: string; isHotspotOrWifi: boolean }[] = [];

    for (const [name, netList] of Object.entries(interfaces)) {
      if (!netList) continue;
      for (const net of netList) {
        // Look for IPv4 and non-internal addresses
        if (net.family === "IPv4" && !net.internal) {
          const isHotspotOrWifi =
            name.toLowerCase().includes("wlan") ||
            name.toLowerCase().includes("en0") ||
            name.toLowerCase().includes("wi-fi") ||
            name.toLowerCase().includes("ap") ||
            name.toLowerCase().includes("hotspot");

          ips.push({
            name,
            ip: net.address,
            isHotspotOrWifi,
          });
        }
      }
    }

    // Sort so Wi-Fi / Hotspot interface (e.g., en0, wlan0) comes first
    ips.sort((a, b) => (b.isHotspotOrWifi ? 1 : 0) - (a.isHotspotOrWifi ? 1 : 0));

    // Determine current request port or default 3000
    const url = new URL(request.url);
    const port = url.port || "3000";
    const primaryIp = ips[0]?.ip || "localhost";

    return NextResponse.json({
      success: true,
      primaryIp,
      port,
      interfaces: ips,
      suggestedBaseUrl: `http://${primaryIp}:${port}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to get network info" },
      { status: 500 }
    );
  }
}
