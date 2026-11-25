// app/api/model-info/route.js
// Server-side proxy for Python backend /api/model-info so the browser never calls the Python service directly.

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPythonApiUrl } from "@/lib/pythonApi";

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const res = await fetch(`${getPythonApiUrl()}/api/model-info`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { success: false, master_data_loaded: false },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch Python model-info:", error);
    return NextResponse.json(
      { success: false, master_data_loaded: false },
      { status: 502 }
    );
  }
}
