import fs from 'node:fs';
import path from 'node:path';

export const prerender = false;

const dataDir = path.resolve('./src/data');
const dataFilePath = path.join(dataDir, 'accessibility_reports.json');

function ensureStorage() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFilePath)) {
    fs.writeFileSync(dataFilePath, '{}', 'utf8');
  }
}

function getReports() {
  try {
    ensureStorage();
    const fileData = fs.readFileSync(dataFilePath, 'utf8');
    return JSON.parse(fileData || '{}');
  } catch (err) {
    console.error("Error reading accessibility reports:", err);
    return {};
  }
}

export async function GET() {
  const reports = getReports();
  return new Response(JSON.stringify(reports), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}

export async function POST({ request }) {
  try {
    ensureStorage();
    const body = await request.json();
    const { stop_id, status, note, photo } = body;

    if (!stop_id || !status) {
      return new Response(JSON.stringify({ error: "Missing stop_id or status" }), { status: 400 });
    }

    const reports = getReports();
    reports[stop_id] = {
      status, // "yes" or "no"
      note: note || "",
      photo: photo || null,
      updated_at: new Date().toISOString()
    };

    fs.writeFileSync(dataFilePath, JSON.stringify(reports, null, 2), 'utf8');

    return new Response(JSON.stringify({ success: true, reports }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error("Error saving report:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}