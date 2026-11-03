import { PatientProfile } from "@/components/doctor/patient-profile";

export default async function PatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  return <PatientProfile patientId={patientId} />;
}
