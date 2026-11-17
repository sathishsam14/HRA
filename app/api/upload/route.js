// app/api/upload/route.js
// API route for handling file uploads (Admin & Handicapper only; Manager blocked with 403).

import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { importFile } from "@/lib/import/index.js";
import db from "@/lib/db";

export async function GET(request) {
  try {
    const session = await getSession(request);
    await requireRole(["ADMIN", "HANDICAPPER"], session);

    const files = await db.uploadedFile.findMany({
      take: 20,
      orderBy: { uploadedAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      files,
    });
  } catch (error) {
    const status = error.status || 500;
    return NextResponse.json(
      { error: error.message || "Failed to fetch uploaded files" },
      { status }
    );
  }
}

export async function POST(request) {
  try {
    // 1. Enforce RBAC: Admin and Handicapper only; Manager refused with 403
    const session = await getSession(request);
    await requireRole(["ADMIN", "HANDICAPPER"], session);

    // 2. Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file");
    const fileType = formData.get("fileType");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { ok: false, message: "No file provided for upload" },
        { status: 400 }
      );
    }

    if (!fileType) {
      return NextResponse.json(
        { ok: false, message: "fileType is required" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Execute file import logic (source: UPLOAD)
    const result = await importFile({
      fileName: file.name,
      buffer,
      fileType: String(fileType).toUpperCase(),
      uploadedBy: session?.id || null,
      source: "UPLOAD",
    });

    if (!result.success) {
      return NextResponse.json(
        {
          ok: false,
          message: result.message || "Failed to process uploaded file",
          result,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error("File upload error:", error);
    const status = error.status || 500;
    return NextResponse.json(
      { ok: false, message: error.message || "Failed to process uploaded file" },
      { status }
    );
  }
}
