import type { TagflowStore } from "./tagflowTypes.ts";

/** The retired Firestore adapter cannot offer a paid relay without atomic quota storage. */
export const tagflowUnavailable: TagflowStore = {
  async getModelAudienceProfile() { throw new Error("Audience profiles require the Supabase adapter"); },
  async putModelAudienceProfile() { throw new Error("Audience profiles require the Supabase adapter"); },
  async deleteModelAudienceProfile() { throw new Error("Audience profiles require the Supabase adapter"); },
  async putModelRequest() { throw new Error("Model reports require the Supabase adapter"); },
  async getModelRequest() { throw new Error("Model reports require the Supabase adapter"); },
  async putModelFeedback() { throw new Error("Model reports require the Supabase adapter"); },
  async getModelFeedback() { throw new Error("Model reports require the Supabase adapter"); },
  async deleteModelFeedback() { throw new Error("Model reports require the Supabase adapter"); },
  async readModelReports() { throw new Error("Model reports require the Supabase adapter"); },
  async getTagflowConfig() { return null; },
  async putTagflowConfig() { throw new Error("Tagflow requires the Supabase adapter"); },
  async getTagflowPolicy() { throw new Error("Tagflow requires the Supabase adapter"); },
  async putTagflowPolicy() { throw new Error("Tagflow requires the Supabase adapter"); },
  async getTagflowUsage() { throw new Error("Tagflow requires the Supabase adapter"); },
  async getCreditWindows() { throw new Error("Tagflow requires the Supabase adapter"); },
  async listTagflowUsage() { throw new Error("Tagflow requires the Supabase adapter"); },
  async reserveTagflow() { throw new Error("Tagflow requires the Supabase adapter"); },
  async settleTagflow() { throw new Error("Tagflow requires the Supabase adapter"); },
  async claimVerificationSend() { throw new Error("Tagflow requires the Supabase adapter"); },
};
