import type { TagflowFeedbackInput, TagflowFeedbackResult } from "../../shared/tagflow.ts";
import { button, el, openFormModal } from "../dialogs/formDialog.ts";

/** Ratings are explicit submissions. Conversation text is never attached. */
export function openModelFeedback(requestId: string, rating: "helpful" | "not-helpful", canRemove: boolean, submit: (input: TagflowFeedbackInput) => Promise<TagflowFeedbackResult>): Promise<"helpful" | "not-helpful" | null | undefined> {
  return new Promise(resolve => {
    let answer: "helpful" | "not-helpful" | null | undefined;
    let saving = false;
    const { dialog,card,finish } = openFormModal("model-feedback-dialog","Model feedback",() => resolve(answer),() => !saving);
    const form = el("form","model-feedback-form") as HTMLFormElement;
    const ratingLabel = el("label","ad-field");
    const ratingInput = el("select","ad-input") as HTMLSelectElement;
    for (const [value,label] of [["helpful","Helpful"],["not-helpful","Not helpful"]]) { const option = el("option","",label) as HTMLOptionElement; option.value = value!; ratingInput.append(option); }
    ratingInput.value = rating;
    ratingLabel.append(el("span","","Your rating"),ratingInput);
    const categoryLabel = el("label","ad-field"), category = el("select","ad-input") as HTMLSelectElement;
    for (const [value,label] of [["quality","Answer quality"],["instructions","Following instructions"],["tools","Using tools"],["speed","Response speed"],["reliability","Errors and reliability"],["other","Other"]]) { const option = el("option","",label) as HTMLOptionElement; option.value = value!; category.append(option); }
    categoryLabel.append(el("span","","What is the feedback about?"),category);
    const commentLabel = el("label","ad-field"), comment = el("textarea","ad-input") as HTMLTextAreaElement;
    comment.rows = 4; comment.maxLength = 2000; comment.placeholder = "What worked, or what could improve? Avoid secrets and private code.";
    commentLabel.append(el("span","","Comment (optional)"),comment);
    const sharingLabel = el("label","model-feedback-sharing"), sharing = el("input","") as HTMLInputElement;
    sharing.type = "checkbox";
    sharingLabel.append(sharing,el("span","","Allow this comment to be included in reports shared with the model provider."));
    const note = el("p","usage-note","Sends your rating and what you type to ADCode. Your conversation, files and project details are not attached. Ratings contribute to anonymous provider statistics.");
    const status = el("p","usage-note"); status.setAttribute("role","status");
    const actions = el("div","model-feedback-actions"), cancel = button("Cancel","ad-btn ad-btn-tertiary",finish), send = button("Send feedback","ad-btn ad-btn-primary",() => undefined);
    send.type = "submit";
    const controls: (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement)[] = [ratingInput,category,comment,sharing,cancel,send];
    async function save(clear = false): Promise<void> {
      if (saving) return;
      saving = true;
      for (const control of controls) control.disabled = true;
      status.textContent = "Saving feedback…";
      let result: TagflowFeedbackResult;
      try { result = await submit({ requestId,rating: clear ? null : ratingInput.value as "helpful" | "not-helpful",category: category.value as TagflowFeedbackInput["category"],comment: comment.value,shareWithProvider: sharing.checked }); }
      catch { result = { ok: false,message: "Feedback could not be saved. Try again." }; }
      if (result.ok) { answer = clear ? null : ratingInput.value as "helpful" | "not-helpful"; saving = false; finish(); }
      else { saving = false; status.textContent = result.message; for (const control of controls) control.disabled = false; }
    }
    if (canRemove) { const remove = button("Remove rating","ad-btn ad-btn-tertiary",() => void save(true)); actions.append(remove); controls.push(remove); }
    actions.append(cancel,send);
    form.append(ratingLabel,categoryLabel,commentLabel,sharingLabel,note,status,actions);
    form.addEventListener("submit",event => { event.preventDefault(); void save(); });
    card.append(form); dialog.showModal(); ratingInput.focus();
  });
}
