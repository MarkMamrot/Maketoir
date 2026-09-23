"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

type FormErrors = Partial<Record<"name" | "email" | "business", string>>;

export function ConsultationForm() {
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextErrors: FormErrors = {};
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const business = String(form.get("business") ?? "").trim();
    if (!name) nextErrors.name = "Please enter your name.";
    if (!business) nextErrors.business = "Please enter your business name.";
    if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = "Please enter a valid work email.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) setSubmitted(true);
  }

  if (submitted) return (
    <div className="form-success" role="status"><CheckCircle2 size={38} /><h3>Thanks, we have the brief.</h3><p>This prototype does not send your details yet. In the live site, this is where we would confirm receipt and arrange the first conversation.</p><button className="text-link" type="button" onClick={() => setSubmitted(false)}>Return to the form</button></div>
  );

  return (
    <form className="consultation-form" onSubmit={handleSubmit} noValidate>
      <div className="field-row">
        <label>Your name<input name="name" type="text" autoComplete="name" aria-invalid={Boolean(errors.name)} />{errors.name && <span className="field-error">{errors.name}</span>}</label>
        <label>Work email<input name="email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} />{errors.email && <span className="field-error">{errors.email}</span>}</label>
      </div>
      <div className="field-row">
        <label>Business name<input name="business" type="text" autoComplete="organization" aria-invalid={Boolean(errors.business)} />{errors.business && <span className="field-error">{errors.business}</span>}</label>
        <label>Team size<select name="employees" defaultValue=""><option value="" disabled>Select a range</option><option>1-5 employees</option><option>6-15 employees</option><option>16-35 employees</option><option>35+ employees</option></select></label>
      </div>
      <div className="field-row">
        <label>Current software<select name="software" defaultValue=""><option value="">Not sure / other</option><option>Xero</option><option>QuickBooks</option><option>MYOB</option><option>Cin7</option><option>Lightspeed</option><option>Solvantis</option></select></label>
        <label>Preferred support<select name="delivery" defaultValue=""><option value="">Open to advice</option><option>Local</option><option>Overseas</option><option>Blended</option></select></label>
      </div>
      <label>What would you like help with?<textarea name="needs" rows={4} placeholder="For example: weekly bookkeeping, payroll and catching up two months of reconciliations..." /></label>
      <button className="button form-button" type="submit">Request my consultation <ArrowRight size={18} /></button>
      <p className="form-note">Prototype only: this form does not transmit or store personal information.</p>
    </form>
  );
}