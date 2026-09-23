import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Static assets & api bypass
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/api/install') ||
    pathname.startsWith('/api/system') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check license file
  const licenseFile = path.join(process.cwd(), '.license.json');
  const isLicensed = fs.existsSync(licenseFile);

  // If visiting /install
  if (pathname === '/install') {
    return NextResponse.next();
  }

  // If accessing dashboard and unlicensed, redirect to /install
  if (!isLicensed && (pathname.startsWith('/dashboard') || pathname.startsWith('/auth'))) {
    const installUrl = new URL('/install', req.url);
    return NextResponse.redirect(installUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
