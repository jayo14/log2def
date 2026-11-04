import { create } from 'zustand';
import { configApi } from './api';

export type FeatureFlagName =
  | 'logbook_camera_capture'
  | 'logbook_bulk_upload'
  | 'logbook_pdf_upload'
  | 'logbook_image_processing'
  | 'ocr_extraction'
  | 'ai_logbook_structuring'
  | 'missing_information_collection'
  | 'report_generation'
  | 'report_editor'
  | 'report_preview'
  | 'report_docx_export'
  | 'report_pdf_export'
  | 'report_quality_validation'
  | 'defence_preparation'
  | 'slide_generation'
  | 'payment_processing'
  | 'print_fulfilment'
  | 'delivery_management'
  | 'supervisor_portal'
  | 'institution_management'
  | 'advanced_analytics'
  | 'ai_chat_assistant';

export type FeatureFlags = Record<FeatureFlagName, boolean>;

// Default feature flags as strictly defined in docs/MVP_SCOPE.md section 4
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  // Core MVP Capabilities (Default: ON)
  logbook_camera_capture: true,
  logbook_bulk_upload: true,
  logbook_pdf_upload: true,
  logbook_image_processing: true,
  ocr_extraction: true,
  ai_logbook_structuring: true,
  missing_information_collection: true,
  report_generation: true,
  report_editor: true,
  report_preview: true,
  report_docx_export: true,
  report_pdf_export: true,
  report_quality_validation: true,

  // Out-of-Scope Capabilities (Default: OFF)
  defence_preparation: false,
  slide_generation: false,
  payment_processing: false,
  print_fulfilment: false,
  delivery_management: false,
  supervisor_portal: false,
  institution_management: false,
  advanced_analytics: false,
  ai_chat_assistant: false,
};

interface FeatureFlagStore {
  flags: FeatureFlags;
  isLoading: boolean;
  hasLoaded: boolean;
  fetchFlags: () => Promise<void>;
  isEnabled: (flag: FeatureFlagName) => boolean;
}

export const useFeatureFlags = create<FeatureFlagStore>((set, get) => ({
  flags: { ...DEFAULT_FEATURE_FLAGS },
  isLoading: false,
  hasLoaded: false,

  fetchFlags: async () => {
    set({ isLoading: true });
    try {
      const serverFlags = await configApi.getFeatureFlags();
      set({
        flags: {
          ...DEFAULT_FEATURE_FLAGS,
          ...serverFlags,
        },
        hasLoaded: true,
        isLoading: false,
      });
    } catch {
      // Retain secure offline defaults
      set({ isLoading: false, hasLoaded: true });
    }
  },

  isEnabled: (flag: FeatureFlagName) => {
    const currentFlags = get().flags;
    return Boolean(currentFlags[flag]);
  },
}));
