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
      readings: {
        Row: {
          card_ids: number[]
          created_at: string
          id: string
          interpretation: string | null
          mode: string
          spread_type: string
          user_id: string
        }
        Insert: {
          card_ids: number[]
          created_at?: string
          id?: string
          interpretation?: string | null
          mode?: string
          spread_type: string
          user_id: string
        }
        Update: {
          card_ids?: number[]
          created_at?: string
          id?: string
          interpretation?: string | null
          mode?: string
          spread_type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          accent: string
          accent_color: string | null
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
          heading_font: string | null
          heading_font_size: number | null
          initial_intention: string | null
          is_premium: boolean
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
          resting_opacity: number
          rising_sign: string | null
          saved_themes: Json
          show_labels: boolean
          show_reversals: boolean
          sun_sign: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accent?: string
          accent_color?: string | null
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
          heading_font?: string | null
          heading_font_size?: number | null
          initial_intention?: string | null
          is_premium?: boolean
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
          resting_opacity?: number
          rising_sign?: string | null
          saved_themes?: Json
          show_labels?: boolean
          show_reversals?: boolean
          sun_sign?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accent?: string
          accent_color?: string | null
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
          heading_font?: string | null
          heading_font_size?: number | null
          initial_intention?: string | null
          is_premium?: boolean
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
          resting_opacity?: number
          rising_sign?: string | null
          saved_themes?: Json
          show_labels?: boolean
          show_reversals?: boolean
          sun_sign?: string | null
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
