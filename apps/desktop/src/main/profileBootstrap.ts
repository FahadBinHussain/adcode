import { app } from "electron";
import { initializeLaunchProfile } from "./launchProfile.ts";

// Run before modules capture storage paths and before acquiring the instance lock.
const profile = initializeLaunchProfile(app, process.argv, process.env);
// A child launch must share the explicit profile and its single-instance lock.
if (profile !== null) process.env["ADCODE_USER_DATA_DIR"] = profile;
