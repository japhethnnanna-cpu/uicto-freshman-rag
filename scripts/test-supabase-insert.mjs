import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({
  path: ".env.local",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

console.log("Testing Supabase INSERT...");

const testRecord = {
  external_id: "TEST-001",
  category: "TEST",
  question: "This is a temporary test question.",
  answer: "This is a temporary test answer.",
  source: "connection-test",
};

const { data, error } = await supabase
  .from("school_knowledge")
  .insert(testRecord)
  .select();

if (error) {
  console.error("INSERT FAILED");
  console.error(error);
  process.exit(1);
}

console.log("INSERT SUCCESSFUL");
console.log(data);