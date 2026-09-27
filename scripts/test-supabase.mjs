import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url) {
  throw new Error("SUPABASE_URL is missing.");
}

if (!secretKey) {
  throw new Error(
    "SUPABASE_SECRET_KEY is missing."
  );
}

const supabase = createClient(
  url,
  secretKey
);

const { data, error } = await supabase
  .from("school_knowledge")
  .select(
    "id, external_id, category, question"
  )
  .limit(5);

if (error) {
  throw new Error(
    `Supabase error: ${error.message}`
  );
}

console.log(
  "Supabase connection successful."
);

console.log(data);