/**
 * Thin API client — all calls are relative so they work through HA Ingress.
 */

async function _request(method, path, body) {
  const res = await fetch(`./api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); msg = j.error || j.detail || msg; } catch { msg = text || msg; }
    throw new Error(msg);
  }
  return res.json().catch(() => ({}));
}

export const api = {
  // Trips
  getTrips:    ()          => _request("GET",    "/trips"),
  getTrip:     (id)        => _request("GET",    `/trips/${id}`),
  createTrip:  (body)      => _request("POST",   "/trips", body),
  updateTrip:  (id, body)  => _request("PUT",    `/trips/${id}`, body),
  deleteTrip:  (id)        => _request("DELETE", `/trips/${id}`),

  // Legs
  createLeg:   (tripId, body) => _request("POST",   `/trips/${tripId}/legs`, body),
  getLeg:      (id)           => _request("GET",    `/legs/${id}`),
  updateLeg:   (id, body)     => _request("PUT",    `/legs/${id}`, body),
  deleteLeg:   (id)           => _request("DELETE", `/legs/${id}`),

  // Checklist
  getChecklist:   (legId)       => _request("GET",    `/legs/${legId}/checklist`),
  addItem:        (legId, body) => _request("POST",   `/legs/${legId}/checklist`, body),
  patchItem:      (id, body)    => _request("PATCH",  `/checklist/${id}`, body),
  deleteItem:     (id)          => _request("DELETE", `/checklist/${id}`),

  // Documents
  getDocuments:   (legId)       => _request("GET",    `/legs/${legId}/documents`),
  uploadDocument: (legId, body) => _request("POST",   `/legs/${legId}/documents`, body),
  getDocument:    (id)          => _request("GET",    `/documents/${id}`),
  deleteDocument: (id)          => _request("DELETE", `/documents/${id}`),

  // Stays
  createStay:           (tripId, body) => _request("POST",   `/trips/${tripId}/stays`, body),
  getStay:              (id)            => _request("GET",    `/stays/${id}`),
  updateStay:           (id, body)      => _request("PUT",    `/stays/${id}`, body),
  deleteStay:           (id)            => _request("DELETE", `/stays/${id}`),
  getStayChecklist:     (stayId)        => _request("GET",    `/stays/${stayId}/checklist`),
  addStayChecklistItem: (stayId, body)  => _request("POST",   `/stays/${stayId}/checklist`, body),
  getStayDocuments:     (stayId)        => _request("GET",    `/stays/${stayId}/documents`),
  uploadStayDocument:   (stayId, body)  => _request("POST",   `/stays/${stayId}/documents`, body),

  // Reminders
  createReminder:   (body)      => _request("POST",   "/reminders", body),
  updateReminder:   (id, body)  => _request("PUT",    `/reminders/${id}`, body),
  markReminderDone: (id)        => _request("POST",   `/reminders/${id}/done`),
  deleteReminder:   (id)        => _request("DELETE", `/reminders/${id}`),

  // AI extraction from document
  extract: (body) => _request("POST", "/extract", body),

  // Chat
  chat: (tripId, message) => _request("POST", "/chat", { trip_id: tripId, message }),
};
