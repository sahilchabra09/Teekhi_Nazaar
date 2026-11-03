import { createAuth } from "@Teekhi_Nazaar/auth";
import { createDb } from "@Teekhi_Nazaar/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
