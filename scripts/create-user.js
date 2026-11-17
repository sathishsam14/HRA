// scripts/create-user.js
// CLI utility to create or update an HRA user.
// Usage: node scripts/create-user.js <email> <role>
// Prompts for password in the terminal without echoing.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import readline from "node:readline";

const prisma = new PrismaClient();

const VALID_ROLES = ["ADMIN", "HANDICAPPER", "MANAGER", "MANAGER"];

function promptPassword(promptText = "Enter password: ") {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Mask input in terminal
    process.stdout.write(promptText);

    let password = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (char) => {
      char = String(char);
      switch (char) {
        case "\n":
        case "\r":
        case "\u0004": // EOF
          process.stdin.setRawMode(false);
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(password);
          break;
        case "\u0003": // Ctrl+C
          process.stdin.setRawMode(false);
          process.exit(130);
          break;
        case "\u007f": // Backspace
        case "\b":
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write("\b \b");
          }
          break;
        default:
          password += char;
          process.stdout.write("*");
          break;
      }
    };

    process.stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const email = (args[0] || "").trim().toLowerCase();
  const rawRole = (args[1] || "").trim().toUpperCase();

  if (!email || !rawRole) {
    console.error("Usage: node scripts/create-user.js <email> <role>");
    console.error("Valid roles: ADMIN, HANDICAPPER, MANAGER");
    process.exit(1);
  }

  if (!VALID_ROLES.includes(rawRole)) {
    console.error(`Invalid role: "${rawRole}". Valid roles are: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const password = await promptPassword(`Enter password for ${email} (${rawRole}): `);

  if (!password || password.length < 6) {
    console.error("Password must be at least 6 characters long.");
    process.exit(1);
  }

  console.log("\nHashing password and saving user...");
  const passwordHash = await bcrypt.hash(password, 10);

  const name = email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      role: rawRole,
      passwordHash,
      active: true,
      failedLogins: 0,
      lockedUntil: null,
    },
    create: {
      email,
      name,
      role: rawRole,
      passwordHash,
      active: true,
      failedLogins: 0,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "USER_CREATED",
      userId: user.id,
      entity: "User",
      entityId: String(user.id),
      reason: `Created user via CLI tool: ${email} with role ${rawRole}`,
    },
  });

  console.log(`✅ User ${user.email} successfully created/updated with role ${user.role}!`);
}

main()
  .catch((e) => {
    console.error("❌ Failed to create user:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
