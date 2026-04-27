export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      custom_guides: {
        Row: {
          base_guide_id: string
          created_at: string
          facets: string[] | null
          id: string
          name: string
          updated_at: string
          user_id: string
          voice_overrides: Json | null
        }
        Insert: {
          base_guide_id: string
          created_at?: string
          facets?: string[] | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
          voice_overrides?: Json | null
        }
        Update: {
          base_guide_id?: string
          created_at?: string
          facets?: string[] | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          voice_overrides?: Json | null
        }
        Relationships: []
      }
      memory_snapshots: {
        Row: {
          active_patterns_summary: string | null
          active_threads_summary: string | null
          card_frequencies: Json
          expires_at: string
          generated_at: string
          id: string
          recent_tags: string[]
          snapshot_type: string
          token_count: number
          user_id: string
        }
        Insert: {
          active_patterns_summary?: string | null
          active_threads_summary?: string | null
          card_frequencies?: Json
          expires_at?: string
          generated_at?: string
          id?: string
          recent_tags?: string[]
          snapshot_type: string
          token_count?: number
          user_id: string
        }
        Update: {
          active_patterns_summary?: string | null
          active_threads_summary?: string | null
          card_frequencies?: Json
          expires_at?: string
          generated_at?: string
          id?: string
          recent_tags?: string[]
          snapshot_type?: string
          token_count?: number
          user_id?: string
        }
        Relationships: []
      }
      reading_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          reading_id: string
          storage_path: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          reading_id: string
          storage_path: string
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          reading_id?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_photos_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "readings"
            referencedColumns: ["id"]
          },
        ]
      }
      readings: {
        Row: {
          card_ids: number[]
          created_at: string
          guide_id: string | null
          id: string
          interpretation: string | null
          is_favorite: boolean
          lens_id: string | null
          mode: string
          moon_phase: string | null
          note: string | null
          question: string | null
          spread_type: string
          tags: string[]
          user_id: string
        }
        Insert: {
          card_ids: number[]
          created_at?: string
          guide_id?: string | null
          id?: string
          interpretation?: string | null
          is_favorite?: boolean
          lens_id?: string | null
          mode?: string
          moon_phase?: string | null
          note?: string | null
          question?: string | null
          spread_type: string
          tags?: string[]
          user_id: string
        }
        Update: {
          card_ids?: number[]
          created_at?: string
          guide_id?: string | null
          id?: string
          interpretation?: string | null
          is_favorite?: boolean
          lens_id?: string | null
          mode?: string
          moon_phase?: string | null
          note?: string | null
          question?: string | null
          spread_type?: string
          tags?: string[]
          user_id?: string
        }
        Relationships: []
      }
      symbolic_threads: {
        Row: {
          card_ids: number[]
          detected_at: string
          id: string
          name: string | null
          reading_ids: string[]
          status: string
          summary: string
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          card_ids?: number[]
          detected_at?: string
          id?: string
          name?: string | null
          reading_ids?: string[]
          status?: string
          summary: string
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          card_ids?: number[]
          detected_at?: string
          id?: string
          name?: string | null
          reading_ids?: string[]
          status?: string
          summary?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          accent: string
          accent_color: string | null
          active_guide_id: string | null
          active_theme_slot: number | null
          bg_gradient_from: string | null
          bg_gradient_to: string | null
          birth_date: string | null
          birth_place: string | null
          birth_time: string | null
          card_back: string
          default_life_area: string
          default_spread: string
          display_name: string | null
          guide_facets: string[] | null
          guide_lens: string | null
          heading_font: string | null
          heading_font_size: number | null
          initial_intention: string | null
          is_premium: boolean
          memory_ai_permission: boolean
          moon_ai_phase: boolean
          moon_ai_sign: boolean
          moon_features_enabled: boolean
          moon_show_carousel: boolean
          moon_void_warning: boolean
          oracle_mode: boolean
          outcome_reminder_days: number
          outcome_reminders_enabled: boolean
          premium_expires_at: string | null
          premium_months_used: number
          premium_since: string | null
          premium_tier: string | null
          premium_warning_sent_at: string | null
          reading_font_size: number
          resting_opacity: number
          rising_sign: string | null
          saved_themes: Json
          show_labels: boolean
          show_reversals: boolean
          sun_sign: string | null
          ui_density: number
          updated_at: string
          user_id: string
        }
        Insert: {
          accent?: string
          accent_color?: string | null
          active_guide_id?: string | null
          active_theme_slot?: number | null
          bg_gradient_from?: string | null
          bg_gradient_to?: string | null
          birth_date?: string | null
          birth_place?: string | null
          birth_time?: string | null
          card_back?: string
          default_life_area?: string
          default_spread?: string
          display_name?: string | null
          guide_facets?: string[] | null
          guide_lens?: string | null
          heading_font?: string | null
          heading_font_size?: number | null
          initial_intention?: string | null
          is_premium?: boolean
          memory_ai_permission?: boolean
          moon_ai_phase?: boolean
          moon_ai_sign?: boolean
          moon_features_enabled?: boolean
          moon_show_carousel?: boolean
          moon_void_warning?: boolean
          oracle_mode?: boolean
          outcome_reminder_days?: number
          outcome_reminders_enabled?: boolean
          premium_expires_at?: string | null
          premium_months_used?: number
          premium_since?: string | null
          premium_tier?: string | null
          premium_warning_sent_at?: string | null
          reading_font_size?: number
          resting_opacity?: number
          rising_sign?: string | null
          saved_themes?: Json
          show_labels?: boolean
          show_reversals?: boolean
          sun_sign?: string | null
          ui_density?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          accent?: string
          accent_color?: string | null
          active_guide_id?: string | null
          active_theme_slot?: number | null
          bg_gradient_from?: string | null
          bg_gradient_to?: string | null
          birth_date?: string | null
          birth_place?: string | null
          birth_time?: string | null
          card_back?: string
          default_life_area?: string
          default_spread?: string
          display_name?: string | null
          guide_facets?: string[] | null
          guide_lens?: string | null
          heading_font?: string | null
          heading_font_size?: number | null
          initial_intention?: string | null
          is_premium?: boolean
          memory_ai_permission?: boolean
          moon_ai_phase?: boolean
          moon_ai_sign?: boolean
          moon_features_enabled?: boolean
          moon_show_carousel?: boolean
          moon_void_warning?: boolean
          oracle_mode?: boolean
          outcome_reminder_days?: number
          outcome_reminders_enabled?: boolean
          premium_expires_at?: string | null
          premium_months_used?: number
          premium_since?: string | null
          premium_tier?: string | null
          premium_warning_sent_at?: string | null
          reading_font_size?: number
          resting_opacity?: number
          rising_sign?: string | null
          saved_themes?: Json
          show_labels?: boolean
          show_reversals?: boolean
          sun_sign?: string | null
          ui_density?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_streaks: {
        Row: {
          current_streak: number
          last_draw_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          last_draw_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          last_draw_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_tags: {
        Row: {
          created_at: string
          id: string
          name: string
          usage_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          usage_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
