import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

const secretKey =
  process.env.SUPABASE_SECRET_KEY;

const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function keyType(key) {
  if (!key) {
    return "MISSING";
  }

  if (key.startsWith("sb_secret_")) {
    return "SECRET KEY ✓";
  }

  if (key.startsWith("sb_publishable_")) {
    return "PUBLISHABLE KEY ✗";
  }

  if (key.startsWith("eyJ")) {
    return "LEGACY JWT KEY ✗";
  }

  return "UNKNOWN KEY TYPE";
}

console.log(
  "SUPABASE_SECRET_KEY:",
  keyType(secretKey)
);

console.log(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:",
  keyType(publishableKey)
);