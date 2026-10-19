const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('log2def_token');
}

export function setAuthToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('log2def_token', token);
  }
}

export function removeAuthToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('log2def_token');
    localStorage.removeItem('log2def_user');
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // If not FormData, default content-type to application/json
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error) {
        errorDetail = errJson.error;
      } else if (errJson.detail) {
        errorDetail = errJson.detail;
      } else if (typeof errJson === 'object' && errJson !== null) {
        const messages: string[] = [];
        for (const [key, val] of Object.entries(errJson)) {
          const text = Array.isArray(val) ? val.join(' ') : String(val);
          if (key === 'non_field_errors') {
            messages.push(text);
          } else {
            messages.push(`${key}: ${text}`);
          }
        }
        if (messages.length > 0) {
          errorDetail = messages.join('. ');
        } else {
          errorDetail = JSON.stringify(errJson);
        }
      }
    } catch {
      // fallback to status text
      errorDetail = response.statusText || errorDetail;
    }
    throw new Error(errorDetail);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: async (credentials: any) => {
    const res = await apiRequest<{ access: string; refresh: string; user: any }>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    setAuthToken(res.access);
    if (typeof window !== 'undefined') {
      localStorage.setItem('log2def_user', JSON.stringify(res.user));
    }
    return res;
  },

  register: async (data: any) => {
    const res = await apiRequest<{ tokens: { access: string; refresh: string }; user: any }>('/auth/register/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setAuthToken(res.tokens.access);
    if (typeof window !== 'undefined') {
      localStorage.setItem('log2def_user', JSON.stringify(res.user));
    }
    return res;
  },

  getCurrentUser: async () => {
    return apiRequest('/auth/me/');
  },

  requestPasswordReset: async (email: string) => {
    return apiRequest<{ detail: string; reset_token?: string; reset_url?: string }>('/auth/password-reset/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  confirmPasswordReset: async (data: { token: string; password: string; password_confirm: string }) => {
    return apiRequest<{ detail: string }>('/auth/password-reset/confirm/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getAiStatus: async () => {
    return apiRequest('/ai/status/');
  },
};

// Projects API
export const projectsApi = {
  list: async () => {
    return apiRequest<any[]>('/projects/');
  },

  get: async (id: number | string) => {
    return apiRequest(`/projects/${id}/`);
  },

  create: async (data: any) => {
    return apiRequest('/projects/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: number | string, data: any) => {
    return apiRequest(`/projects/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: number | string) => {
    return apiRequest(`/projects/${id}/`, {
      method: 'DELETE',
    });
  },

  // Documents
  uploadDocument: async (projectId: number | string, formData: FormData) => {
    return apiRequest(`/projects/${projectId}/documents/`, {
      method: 'POST',
      body: formData,
    });
  },

  deleteDocument: async (projectId: number | string, docId: number | string) => {
    return apiRequest(`/projects/${projectId}/documents/${docId}/`, {
      method: 'DELETE',
    });
  },

  reprocessDocument: async (projectId: number | string, docId: number | string) => {
    return apiRequest(`/projects/${projectId}/documents/${docId}/reprocess/`, {
      method: 'POST',
    });
  },

  updatePage: async (projectId: number | string, pageId: number | string, data: any) => {
    return apiRequest(`/projects/${projectId}/pages/${pageId}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Logbook Entries
  getLogbookEntries: async (projectId: number | string) => {
    return apiRequest<any[]>(`/projects/${projectId}/logbook-entries/`);
  },

  createLogbookEntry: async (projectId: number | string, data: any) => {
    return apiRequest(`/projects/${projectId}/logbook-entries/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateLogbookEntry: async (projectId: number | string, entryId: number | string, data: any) => {
    return apiRequest(`/projects/${projectId}/logbook-entries/${entryId}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteLogbookEntry: async (projectId: number | string, entryId: number | string) => {
    return apiRequest(`/projects/${projectId}/logbook-entries/${entryId}/`, {
      method: 'DELETE',
    });
  },

  bulkVerifyEntries: async (projectId: number | string, entryIds?: number[]) => {
    return apiRequest(`/projects/${projectId}/logbook-entries/bulk-verify/`, {
      method: 'POST',
      body: JSON.stringify({ entry_ids: entryIds }),
    });
  },

  // Report & Sections
  getReport: async (projectId: number | string) => {
    return apiRequest(`/projects/${projectId}/report/`);
  },

  generateReport: async (projectId: number | string, forceAll: boolean = false) => {
    return apiRequest(`/projects/${projectId}/report/generate/`, {
      method: 'POST',
      body: JSON.stringify({ force_all: forceAll }),
    });
  },

  updateSection: async (projectId: number | string, sectionId: number | string, data: any) => {
    return apiRequest(`/projects/${projectId}/report/sections/${sectionId}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  regenerateSection: async (projectId: number | string, sectionId: number | string) => {
    return apiRequest(`/projects/${projectId}/report/sections/${sectionId}/regenerate/`, {
      method: 'POST',
    });
  },

  
  // Report Version Control

  getReportVersions: async (projectId: number | string) => {
    return apiRequest<any[]>(`/projects/${projectId}/report/versions/`);
  },

  createReportVersion: async (projectId: number | string, summary?: string) => {
    return apiRequest(`/projects/${projectId}/report/versions/`, {
      method: 'POST',
      body: JSON.stringify({ summary }),
    });
  },

  revertReportVersion: async (projectId: number | string, versionId: number | string) => {
    return apiRequest(`/projects/${projectId}/report/versions/${versionId}/revert/`, {
      method: 'POST',
    });
  },

  // Document Export Download URLs
  getExportDocxUrl: (projectId: number | string) => {
    return `${API_BASE_URL}/projects/${projectId}/export/docx/`;
  },

  getExportPdfUrl: (projectId: number | string) => {
    return `${API_BASE_URL}/projects/${projectId}/export/pdf/`;
  },

  downloadDocx: async (projectId: number | string, filename: string = 'siwes_report.docx') => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE_URL}/projects/${projectId}/export/docx/`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error('DOCX download failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },

  downloadPdf: async (projectId: number | string, filename: string = 'siwes_report.pdf') => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE_URL}/projects/${projectId}/export/pdf/`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error('PDF download failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },

  // Defence
  generateDefenceQuestions: async (projectId: number | string) => {
    return apiRequest<any[]>(`/projects/${projectId}/defence/generate/`, {
      method: 'POST',
    });
  },

  getDefenceQuestions: async (projectId: number | string) => {
    return apiRequest<any[]>(`/projects/${projectId}/defence/questions/`);
  },

  updateDefenceQuestion: async (projectId: number | string, questionId: number | string, data: any) => {
    return apiRequest(`/projects/${projectId}/defence/questions/${questionId}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  recordDefenceSession: async (projectId: number | string, data: any) => {
    return apiRequest(`/projects/${projectId}/defence/session/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },