import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({
  path: ".env.local",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

console.log("Testing Supabase connection...");

const { data, error } = await supabase
  .from("school_knowledge")
  .select("id")
  .limit(1);

if (error) {
  console.error("Supabase error:");
  console.error(error);
  process.exit(1);
}

console.log("Supabase is reachable.");
console.log(data);