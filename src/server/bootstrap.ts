// ============================================================
// BOOTSTRAP — muat .env SEBELUM modul lain di-import
// ------------------------------------------------------------
// Menyiapkan DATABASE_URL, AUTH_SECRET, sinkronisasi DB (prisma db push),
// dan auto-seed SUPERADMIN serta License sebelum HTTP server dinyalakan.
// ============================================================
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function loadEnvFile(file: string) {
    try {
        const p = path.resolve(process.cwd(), file);
        if (!fs.existsSync(p)) return;
        const content = fs.readFileSync(p, "utf8");
        for (const rawLine of content.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            const eq = line.indexOf("=");
            if (eq === -1) continue;
            const key = line.slice(0, eq).trim();
            if (!key || process.env[key] !== undefined) continue; // jangan timpa env yg sudah ada
            let val = line.slice(eq + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
            ) {
                val = val.slice(1, -1);
            }
            process.env[key] = val;
        }
    } catch {
        /* ignore */
    }
}

// .env.local menimpa .env (urutan: yang lebih spesifik dimuat dulu)
loadEnvFile(".env.local");
loadEnvFile(".env");

// Set NODE_ENV to production if running start or if not dev
if (process.env.npm_lifecycle_event === "start" || (!process.env.NODE_ENV && process.env.npm_lifecycle_event !== "dev")) {
    (process.env as any).NODE_ENV = "production";
}

// Function to sanitize database URLs (strip quotes, fix protocols, ignore unresolved templates)
function sanitizeDbUrl(url?: string): string | undefined {
    if (!url) return undefined;
    let clean = url.trim();
    if (
        (clean.startsWith('"') && clean.endsWith('"')) ||
        (clean.startsWith("'") && clean.endsWith("'"))
    ) {
        clean = clean.slice(1, -1).trim();
    }
    // If it's an unresolved Railway template (e.g. ${{MySQL.MYSQL_URL}}), return undefined
    if (clean.startsWith("${{") || clean.includes("${{")) {
        return undefined;
    }
    // If user forgot mysql:// prefix but provided host credentials
    if (!clean.includes("://") && clean.includes("@")) {
        clean = "mysql://" + clean;
    }
    return clean;
}

process.env.DATABASE_URL = sanitizeDbUrl(process.env.DATABASE_URL);

// Fallback DATABASE_URL untuk Railway / Render / cloud hosting
if (!process.env.DATABASE_URL) {
    const fallback = sanitizeDbUrl(
        process.env.MYSQL_URL ||
        process.env.MYSQL_PRIVATE_URL ||
        process.env.DATABASE_PRIVATE_URL ||
        process.env.MYSQL_PUBLIC_URL ||
        process.env.DATABASE_PUBLIC_URL ||
        process.env.JAWSDB_URL ||
        process.env.CLEARDB_DATABASE_URL
    );

    if (fallback) {
        process.env.DATABASE_URL = fallback;
    } else if (process.env.MYSQLHOST && process.env.MYSQLUSER) {
        const user = encodeURIComponent(process.env.MYSQLUSER);
        const pass = encodeURIComponent(process.env.MYSQLPASSWORD || "");
        const host = process.env.MYSQLHOST;
        const port = process.env.MYSQLPORT || "3306";
        const db = process.env.MYSQLDATABASE || "railway";
        process.env.DATABASE_URL = `mysql://${user}:${pass}@${host}:${port}/${db}`;
    }
}

// Auto-detect public URL for Railway / Cloud
if (!process.env.NEXTAUTH_URL && !process.env.AUTH_URL) {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
    if (domain) {
        const fullUrl = `https://${domain}`;
        process.env.NEXTAUTH_URL = fullUrl;
        process.env.AUTH_URL = fullUrl;
        process.env.BASE_URL = fullUrl;
        process.env.NEXT_PUBLIC_APP_URL = fullUrl;
    }
}

// Fallback AUTH_SECRET & AUTH_TRUST_HOST agar NextAuth tidak melempar 500 error
if (!process.env.AUTH_SECRET) {
    process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET || "akg-default-production-auth-secret-key-928471";
}
if (!process.env.AUTH_TRUST_HOST) {
    process.env.AUTH_TRUST_HOST = "true";
}

async function initDatabaseAndSeed() {
    if (!process.env.DATABASE_URL) {
        console.warn("[Bootstrap] Warning: DATABASE_URL is not set. Skipping schema sync.");
        return;
    }

    // A. Sinkronisasi schema Prisma ke database (membuat tabel yang belum ada di MySQL)
    try {
        console.log("[Bootstrap] Ensuring database schema is synced with Prisma...");
        execSync("npx prisma db push --skip-generate --accept-data-loss", {
            stdio: "inherit",
            env: process.env,
        });
        console.log("[Bootstrap] Database schema synced successfully.");
    } catch (err: any) {
        console.error("[Bootstrap] Warning during schema sync (non-fatal):", err?.message || err);
    }

    // B. Pastikan akun Super Admin ada dan aktif
    try {
        const { prisma } = await import("../lib/prisma");
        const bcrypt = (await import("bcryptjs")).default || (await import("bcryptjs"));

        const adminEmail = (process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
        let adminPassword = process.env.ADMIN_PASSWORD || "admin123";
        if (adminPassword === "change-this-in-production" || !adminPassword.trim()) {
            adminPassword = "admin123";
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: adminEmail }
        });

        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        if (!existingUser) {
            console.log(`[Bootstrap] Creating default SUPERADMIN: ${adminEmail}...`);
            await prisma.user.create({
                data: {
                    email: adminEmail,
                    name: "Super Admin",
                    password: hashedPassword,
                    role: "SUPERADMIN"
                }
            });
            console.log(`[Bootstrap] SUPERADMIN created successfully (${adminEmail} / ${adminPassword})`);
        } else {
            // Update role and password so login credentials always work
            await prisma.user.update({
                where: { email: adminEmail },
                data: {
                    role: "SUPERADMIN",
                    password: hashedPassword
                }
            });
            console.log(`[Bootstrap] SUPERADMIN user ${adminEmail} verified (password: ${adminPassword}).`);
        }

        // C. Pastikan SystemLicense aktif di database
        const { computeLicenseSignature } = await import("../lib/license/integrity");
        const code = "WEBOT-REG-9274-6AAF-052C";
        const domain = "localhost";
        const licenseType = "regular";
        const activatedAt = new Date("2026-09-23T00:00:00.000Z");
        const signature = computeLicenseSignature(code, domain, licenseType, activatedAt);

        await prisma.systemLicense.upsert({
            where: { id: "singleton" },
            update: {
                status: "active",
                signature,
                purchaseCode: code,
                licensedDomain: domain,
                licenseType
            },
            create: {
                id: "singleton",
                purchaseCode: code,
                licenseType,
                licenseeName: "Ayush Pandey",
                licenseeEmail: adminEmail,
                licensedDomain: domain,
                signature,
                status: "active",
                activatedAt,
                lastVerifiedAt: new Date()
            }
        });
        console.log("[Bootstrap] System License verified and active.");
    } catch (seedErr: any) {
        console.error("[Bootstrap] Warning during seeding (non-fatal):", seedErr?.message || seedErr);
    }
}

async function startServer() {
    await initDatabaseAndSeed();
    await import("./index.js");
}

startServer().catch((e) => {
    console.error("Gagal start server:", e);
    process.exit(1);
});
