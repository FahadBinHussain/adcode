import { AUDIENCE_ROLES, AUDIENCE_EXPERIENCE, DECLARED_USES, type TagflowAudienceInput, type TagflowAudienceResult } from "../../shared/tagflow.ts";
import { button, el, openFormModal } from "../dialogs/formDialog.ts";

const label = (value: string): string => ({ unknown:"Prefer not to say", "professional-developer":"Professional developer", "build-product":"Building a product", "code-review":"Code review", "ui-design":"UI design" } as Record<string,string>)[value] ?? value.charAt(0).toUpperCase()+value.slice(1);
export function openAudienceProfile(access: (input?: TagflowAudienceInput) => Promise<TagflowAudienceResult> = input => window.adcode.aiUsage.audience(input)): Promise<void> {
  return new Promise(resolve => {
    let saving = false, loaded = false;
    const { dialog,card,finish } = openFormModal("model-audience-dialog","About your AI use",resolve,() => !saving);
    const form = el("form","model-feedback-form") as HTMLFormElement;
    function select(title: string,values: readonly string[]): HTMLSelectElement {
      const field = el("label","ad-field"), input = el("select","ad-input") as HTMLSelectElement;
      for (const value of values) { const option = el("option","",label(value)) as HTMLOptionElement; option.value = value; input.append(option); }
      field.append(el("span","",title),input); form.append(field); return input;
    }
    form.append(el("p","usage-note","Optional: help ADCode and its free AI providers understand who uses the service and what they need. Your choices contribute to aggregate reports. Your name, email, conversations and code are not included."));
    const role = select("Which role best describes you?",AUDIENCE_ROLES), experience = select("Coding experience",AUDIENCE_EXPERIENCE), purpose = select("Main reason you use included AI",DECLARED_USES);
    const consent = el("input","") as HTMLInputElement; consent.type = "checkbox";
    const sharing = el("label","model-feedback-sharing"); sharing.append(consent,el("span","","Include my choices in aggregate reports shared with AI providers."));
    const status = el("p","usage-note"); status.setAttribute("role","status");
    const actions = el("div","model-feedback-actions"), cancel = button("Cancel","ad-btn ad-btn-tertiary",finish), send = button("Save choices","ad-btn ad-btn-primary",() => undefined), retry = button("Retry loading","ad-btn ad-btn-tertiary",() => void load()), remove = button("Remove my profile","ad-btn ad-btn-tertiary",() => void save(true));
    send.type = "submit"; retry.hidden = true; remove.hidden = true;
    const fields = [role,experience,purpose,consent,send,remove];
    function enabled(value: boolean): void { for (const field of fields) field.disabled = !value; }
    async function load(): Promise<void> {
      enabled(false); retry.hidden = true; status.textContent = "Loading your choices…";
      let result: TagflowAudienceResult; try { result = await access(); } catch { result = { ok:false,message:"Your choices could not be loaded. Try again." }; }
      if (!dialog.isConnected) return;
      if (!result.ok) { status.textContent = result.message; retry.hidden = false; return; }
      role.value = result.profile?.role ?? "unknown"; experience.value = result.profile?.experience ?? "unknown"; purpose.value = result.profile?.primaryUse ?? "unknown"; consent.checked = result.profile?.consent === true; remove.hidden = result.profile === null;
      loaded = true; enabled(true); status.textContent = "You can update or remove your choices here. Removing them updates future reports, including historical periods. Already downloaded reports cannot be recalled."; role.focus();
    }
    async function save(clear = false): Promise<void> {
      if (!loaded || saving) return;
      saving = true; enabled(false); cancel.disabled = true; status.textContent = "Saving your choices…";
      let result: TagflowAudienceResult;
      try { result = await access({ role:role.value as TagflowAudienceInput["role"], experience:experience.value as TagflowAudienceInput["experience"],primaryUse:purpose.value as TagflowAudienceInput["primaryUse"],consent:clear ? false : consent.checked }); }
      catch { result = { ok:false,message:"Your choices could not be saved. Try again." }; }
      saving = false;
      if (result.ok) finish();
      else { status.textContent = result.message; enabled(true); cancel.disabled = false; }
    }
    actions.append(remove,retry,cancel,send); form.append(sharing,status,actions); form.addEventListener("submit",event => { event.preventDefault(); void save(); }); card.append(form); dialog.showModal(); cancel.focus(); void load();
  });
}
