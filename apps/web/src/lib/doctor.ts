import { api, serverUrl, ApiError } from "./api";

export type Category = "medication" | "progress" | "diagnosis" | "report" | "general";
export type SyncStatus = "pending" | "uploading" | "queued" | "processing" | "processed" | "failed";

export type PatientSummary = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  assignedAt: string;
  records: number;
  lastRecordAt: string | null;
};

export type MedicalRecord = {
  id: string;
  patientId: string;
  authorId: string | null;
  authorName: string | null;
  kind: "note" | "file";
  category: Category;
  title: string;
  body: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  autosageDocumentId: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  createdAt: string;
};

export type PatientDetail = {
  patient: { id: string; name: string; email: string; image: string | null };
  knowledgeBase: { connected: boolean; autosageConfigured: boolean };
  careTeam: { id: string; name: string }[];
  records: MedicalRecord[];
};

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "medication", label: "Medication" },
  { value: "progress", label: "Progress" },
  { value: "diagnosis", label: "Diagnosis" },
  { value: "report", label: "Report" },
  { value: "general", label: "General" },
];

export const doctorApi = {
  patients: () => api<{ patients: PatientSummary[] }>("/api/doctor/patients"),
  addPatient: (email: string) => api<{ patient: { id: string; name: string } }>("/api/doctor/patients", { method: "POST", json: { email } }),
  removePatient: (id: string) => api("/api/doctor/patients/" + id, { method: "DELETE" }),
  patient: (id: string) => api<PatientDetail>("/api/doctor/patients/" + id),
  addNote: (id: string, note: { category: Category; title?: string; body: string }) =>
    api<{ record: MedicalRecord }>(`/api/doctor/patients/${id}/notes`, { method: "POST", json: note }),
  async uploadFile(id: string, file: File, category: Category, title?: string) {
    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    if (title) form.append("title", title);
    return api<{ record: MedicalRecord }>(`/api/doctor/patients/${id}/files`, { method: "POST", body: form });
  },
  retry: (recordId: string) => api(`/api/doctor/records/${recordId}/retry`, { method: "POST" }),
  remove: (recordId: string) => api(`/api/doctor/records/${recordId}`, { method: "DELETE" }),
  download: (recordId: string) => api<{ url: string }>(`/api/doctor/records/${recordId}/download`),
  ask: (id: string, question: string) => api<{ answer: string; ms: number }>(`/api/doctor/patients/${id}/ask`, { method: "POST", json: { question } }),
};

export { ApiError, serverUrl };
