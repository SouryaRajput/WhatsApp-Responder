const bcrypt = require("bcryptjs");
const { connectDb } = require("../config/db");
const User = require("../models/User");

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Admin";

  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD before running seed:admin");
  }

  await connectDb();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.findOneAndUpdate(
    { email },
    { name, email, passwordHash, role: "super_admin", active: true, emailVerified: true },
    { upsert: true, new: true }
  );
  console.log(`Admin ready: ${user.email}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
