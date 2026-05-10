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
      admin_audit_log: {
        Row: {
          action: string
          admin_email: string | null
          admin_user_id: string
          created_at: string
          details: Json
          id: string
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_email?: string | null
          admin_user_id: string
          created_at?: string
          details?: Json
          id?: string
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_email?: string | null
          admin_user_id?: string
          created_at?: string
          details?: Json
          id?: string
          target_email?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_backups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          notes: string | null
          size_bytes: number
          status: string
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          notes?: string | null
          size_bytes?: number
          status?: string
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          notes?: string | null
          size_bytes?: number
          status?: string
          storage_path?: string | null
        }
        Relationships: []
      }
      admin_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      ai_call_log: {
        Row: {
          cached_input_tokens: number
          call_type: string
          cost_usd: number
          created_at: string
          credits_consumed: number
          duration_ms: number | null
          error_code: string | null
          id: string
          idempotency_key: string | null
          input_tokens: number
          model: string
          output_tokens: number
          pattern_id: string | null
          plan_at_time: string
          provider: string
          reading_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          cached_input_tokens?: number
          call_type: string
          cost_usd?: number
          created_at?: string
          credits_consumed?: number
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          input_tokens?: number
          model: string
          output_tokens?: number
          pattern_id?: string | null
          plan_at_time?: string
          provider: string
          reading_id?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          cached_input_tokens?: number
          call_type?: string
          cost_usd?: number
          created_at?: string
          credits_consumed?: number
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          input_tokens?: number
          model?: string
          output_tokens?: number
          pattern_id?: string | null
          plan_at_time?: string
          provider?: string
          reading_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_log_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_log_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "readings"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_grants: {
        Row: {
          created_at: string
          credits_amount: number
          expires_at: string | null
          id: string
          metadata: Json
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_amount: number
          expires_at?: string | null
          id?: string
          metadata?: Json
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_amount?: number
          expires_at?: string | null
          id?: string
          metadata?: Json
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      custom_deck_cards: {
        Row: {
          archived_at: string | null
          card_description: string | null
          card_id: number
          card_name: string | null
          corner_radius_percent: number | null
          created_at: string
          crop_coords: Json | null
          deck_id: string
          display_path: string
          display_url: string
          id: string
          journal_prompts: string[] | null
          original_path: string | null
          processed_at: string | null
          processing_status: string
          radius_overridden: boolean
          source: string
          thumbnail_path: string
          thumbnail_url: string
          updated_at: string
          user_id: string
          variant_attempts: number
          variant_last_attempt_at: string | null
        }
        Insert: {
          archived_at?: string | null
          card_description?: string | null
          card_id: number
          card_name?: string | null
          corner_radius_percent?: number | null
          created_at?: string
          crop_coords?: Json | null
          deck_id: string
          display_path: string
          display_url: string
          id?: string
          journal_prompts?: string[] | null
          original_path?: string | null
          processed_at?: string | null
          processing_status?: string
          radius_overridden?: boolean
          source?: string
          thumbnail_path: string
          thumbnail_url: string
          updated_at?: string
          user_id: string
          variant_attempts?: number
          variant_last_attempt_at?: string | null
        }
        Update: {
          archived_at?: string | null
          card_description?: string | null
          card_id?: number
          card_name?: string | null
          corner_radius_percent?: number | null
          created_at?: string
          crop_coords?: Json | null
          deck_id?: string
          display_path?: string
          display_url?: string
          id?: string
          journal_prompts?: string[] | null
          original_path?: string | null
          processed_at?: string | null
          processing_status?: string
          radius_overridden?: boolean
          source?: string
          thumbnail_path?: string
          thumbnail_url?: string
          updated_at?: string
          user_id?: string
          variant_attempts?: number
          variant_last_attempt_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_deck_cards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "custom_decks"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_decks: {
        Row: {
          card_back_path: string | null
          card_back_thumb_path: string | null
          card_back_thumb_url: string | null
          card_back_url: string | null
          cards_photographed_count: number
          corner_radius_percent: number
          corner_radius_px: number | null
          created_at: string
          deck_type: string
          height_inches: number | null
          id: string
          is_active: boolean
          is_complete: boolean
          name: string
          shape: string
          source_zip_path: string | null
          updated_at: string
          user_id: string
          width_inches: number | null
        }
        Insert: {
          card_back_path?: string | null
          card_back_thumb_path?: string | null
          card_back_thumb_url?: string | null
          card_back_url?: string | null
          cards_photographed_count?: number
          corner_radius_percent?: number
          corner_radius_px?: number | null
          created_at?: string
          deck_type?: string
          height_inches?: number | null
          id?: string
          is_active?: boolean
          is_complete?: boolean
          name: string
          shape: string
          source_zip_path?: string | null
          updated_at?: string
          user_id: string
          width_inches?: number | null
        }
        Update: {
          card_back_path?: string | null
          card_back_thumb_path?: string | null
          card_back_thumb_url?: string | null
          card_back_url?: string | null
          cards_photographed_count?: number
          corner_radius_percent?: number
          corner_radius_px?: number | null
          created_at?: string
          deck_type?: string
          height_inches?: number | null
          id?: string
          is_active?: boolean
          is_complete?: boolean
          name?: string
          shape?: string
          source_zip_path?: string | null
          updated_at?: string
          user_id?: string
          width_inches?: number | null
        }
        Relationships: []
      }
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
      detect_weaves_alerts: {
        Row: {
          created_at: string
          details: Json
          id: string
          kind: string
          message: string
          notified_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          run_id: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          kind: string
          message: string
          notified_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          run_id?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          message?: string
          notified_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          run_id?: string | null
          severity?: string
        }
        Relationships: []
      }
      detect_weaves_lock: {
        Row: {
          id: string
          last_run_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          last_run_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          last_run_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      detect_weaves_runs: {
        Row: {
          alerted: boolean
          duration_ms: number
          finished_at: string
          id: string
          message: string | null
          mode: string
          per_user_errors: Json
          started_at: string
          status: string
          triggered_by: string | null
          users_scanned: number
          weaves_detected: number
          weaves_existing: number
        }
        Insert: {
          alerted?: boolean
          duration_ms?: number
          finished_at?: string
          id?: string
          message?: string | null
          mode?: string
          per_user_errors?: Json
          started_at?: string
          status?: string
          triggered_by?: string | null
          users_scanned?: number
          weaves_detected?: number
          weaves_existing?: number
        }
        Update: {
          alerted?: boolean
          duration_ms?: number
          finished_at?: string
          id?: string
          message?: string | null
          mode?: string
          per_user_errors?: Json
          started_at?: string
          status?: string
          triggered_by?: string | null
          users_scanned?: number
          weaves_detected?: number
          weaves_existing?: number
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          created_at: string
          id: string
          row_count: number
          skipped_count: number
          source_format: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          row_count?: number
          skipped_count?: number
          source_format: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          row_count?: number
          skipped_count?: number
          source_format?: string
          user_id?: string
        }
        Relationships: []
      }
      insight_reflections: {
        Row: {
          cache_key: string
          created_at: string
          id: string
          reflection: string
          user_id: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          id?: string
          reflection: string
          user_id: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          id?: string
          reflection?: string
          user_id?: string
        }
        Relationships: []
      }
      insight_themes: {
        Row: {
          cache_key: string
          created_at: string
          id: string
          themes: Json
          user_id: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          id?: string
          themes: Json
          user_id: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          id?: string
          themes?: Json
          user_id?: string
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
      patterns: {
        Row: {
          ai_generated_at: string | null
          ai_reading_count_at_gen: number | null
          ai_version: string | null
          created_at: string
          description: string | null
          id: string
          interpretation: Json | null
          is_premium: boolean
          is_user_named: boolean
          lifecycle_state: string
          name: string
          narrative_arc: string | null
          per_reading_roles: Json
          reading_ids: string[]
          remarkable_moments: Json
          retired_at: string | null
          story_description: string | null
          story_name: string | null
          thread_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_generated_at?: string | null
          ai_reading_count_at_gen?: number | null
          ai_version?: string | null
          created_at?: string
          description?: string | null
          id?: string
          interpretation?: Json | null
          is_premium?: boolean
          is_user_named?: boolean
          lifecycle_state?: string
          name: string
          narrative_arc?: string | null
          per_reading_roles?: Json
          reading_ids?: string[]
          remarkable_moments?: Json
          retired_at?: string | null
          story_description?: string | null
          story_name?: string | null
          thread_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_generated_at?: string | null
          ai_reading_count_at_gen?: number | null
          ai_version?: string | null
          created_at?: string
          description?: string | null
          id?: string
          interpretation?: Json | null
          is_premium?: boolean
          is_user_named?: boolean
          lifecycle_state?: string
          name?: string
          narrative_arc?: string | null
          per_reading_roles?: Json
          reading_ids?: string[]
          remarkable_moments?: Json
          retired_at?: string | null
          story_description?: string | null
          story_name?: string | null
          thread_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reading_photos: {
        Row: {
          archived_at: string | null
          caption: string | null
          created_at: string
          id: string
          reading_id: string
          storage_path: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          reading_id: string
          storage_path: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
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
          archived_at: string | null
          card_deck_ids: string[]
          card_ids: number[]
          card_orientations: boolean[]
          created_at: string
          dawn_cycle_date: string | null
          deck_id: string | null
          deep_reading_lenses: Json | null
          entry_mode: string
          guide_id: string | null
          id: string
          import_batch_id: string | null
          interpretation: string | null
          is_deep_reading: boolean
          is_favorite: boolean
          journal_prompt_used: boolean
          lens_id: string | null
          mirror_saved: boolean
          mirror_saved_at: string | null
          mirror_significance: string | null
          mode: string
          moon_phase: string | null
          note: string | null
          pattern_id: string | null
          question: string | null
          source: string | null
          spread_type: string
          tags: string[]
          tailored_prompt: string | null
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          card_deck_ids?: string[]
          card_ids: number[]
          card_orientations?: boolean[]
          created_at?: string
          dawn_cycle_date?: string | null
          deck_id?: string | null
          deep_reading_lenses?: Json | null
          entry_mode?: string
          guide_id?: string | null
          id?: string
          import_batch_id?: string | null
          interpretation?: string | null
          is_deep_reading?: boolean
          is_favorite?: boolean
          journal_prompt_used?: boolean
          lens_id?: string | null
          mirror_saved?: boolean
          mirror_saved_at?: string | null
          mirror_significance?: string | null
          mode?: string
          moon_phase?: string | null
          note?: string | null
          pattern_id?: string | null
          question?: string | null
          source?: string | null
          spread_type: string
          tags?: string[]
          tailored_prompt?: string | null
          user_id: string
        }
        Update: {
          archived_at?: string | null
          card_deck_ids?: string[]
          card_ids?: number[]
          card_orientations?: boolean[]
          created_at?: string
          dawn_cycle_date?: string | null
          deck_id?: string | null
          deep_reading_lenses?: Json | null
          entry_mode?: string
          guide_id?: string | null
          id?: string
          import_batch_id?: string | null
          interpretation?: string | null
          is_deep_reading?: boolean
          is_favorite?: boolean
          journal_prompt_used?: boolean
          lens_id?: string | null
          mirror_saved?: boolean
          mirror_saved_at?: string | null
          mirror_significance?: string | null
          mode?: string
          moon_phase?: string | null
          note?: string | null
          pattern_id?: string | null
          question?: string | null
          source?: string | null
          spread_type?: string
          tags?: string[]
          tailored_prompt?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "readings_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "custom_decks"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_event_log: {
        Row: {
          bucket: string
          created_at: string
          deck_id: string | null
          event_type: string
          id: string
          path: string
          reading_id: string | null
          size_bytes: number
          user_id: string | null
        }
        Insert: {
          bucket: string
          created_at?: string
          deck_id?: string | null
          event_type: string
          id?: string
          path: string
          reading_id?: string | null
          size_bytes?: number
          user_id?: string | null
        }
        Update: {
          bucket?: string
          created_at?: string
          deck_id?: string | null
          event_type?: string
          id?: string
          path?: string
          reading_id?: string | null
          size_bytes?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_event_log_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "readings"
            referencedColumns: ["id"]
          },
        ]
      }
      symbolic_threads: {
        Row: {
          ai_generated_at: string | null
          ai_reading_count_at_gen: number | null
          ai_version: string | null
          card_ids: number[]
          description: string | null
          detected_at: string
          evidence_prose: string | null
          evidence_prose_generated_at: string | null
          evidence_prose_layers: Json | null
          evidence_prose_reading_count: number | null
          evidence_prose_version: number | null
          first_seen_at: string
          id: string
          is_premium: boolean
          last_seen_at: string
          name: string | null
          narrative_arc: string | null
          pattern_id: string | null
          per_reading_roles: Json
          reading_ids: string[]
          recurrence_count: number
          remarkable_moments: Json
          status: string
          story_description: string | null
          story_name: string | null
          summary: string
          tags: string[]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_generated_at?: string | null
          ai_reading_count_at_gen?: number | null
          ai_version?: string | null
          card_ids?: number[]
          description?: string | null
          detected_at?: string
          evidence_prose?: string | null
          evidence_prose_generated_at?: string | null
          evidence_prose_layers?: Json | null
          evidence_prose_reading_count?: number | null
          evidence_prose_version?: number | null
          first_seen_at?: string
          id?: string
          is_premium?: boolean
          last_seen_at?: string
          name?: string | null
          narrative_arc?: string | null
          pattern_id?: string | null
          per_reading_roles?: Json
          reading_ids?: string[]
          recurrence_count?: number
          remarkable_moments?: Json
          status?: string
          story_description?: string | null
          story_name?: string | null
          summary: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_generated_at?: string | null
          ai_reading_count_at_gen?: number | null
          ai_version?: string | null
          card_ids?: number[]
          description?: string | null
          detected_at?: string
          evidence_prose?: string | null
          evidence_prose_generated_at?: string | null
          evidence_prose_layers?: Json | null
          evidence_prose_reading_count?: number | null
          evidence_prose_version?: number | null
          first_seen_at?: string
          id?: string
          is_premium?: boolean
          last_seen_at?: string
          name?: string | null
          narrative_arc?: string | null
          pattern_id?: string | null
          per_reading_roles?: Json
          reading_ids?: string[]
          recurrence_count?: number
          remarkable_moments?: Json
          status?: string
          story_description?: string | null
          story_name?: string | null
          summary?: string
          tags?: string[]
          title?: string | null
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
          admin_note: string | null
          ai_blocked: boolean
          ai_blocked_reason: string | null
          ai_tone: string
          allow_reversed_cards: boolean
          archive_deepening_unlocked: boolean
          bg_gradient_from: string | null
          bg_gradient_to: string | null
          birth_date: string | null
          birth_place: string | null
          birth_time: string | null
          card_back: string
          community_theme: string | null
          custom_draw_count: number | null
          default_life_area: string
          default_share_color: string
          default_spread: string
          dismissed_hints: Json
          display_name: string | null
          gifted_by: string | null
          guide_facets: string[] | null
          guide_lens: string | null
          heading_font: string | null
          heading_font_size: number | null
          initial_intention: string | null
          is_premium: boolean
          last_share_level: string | null
          memory_ai_permission: boolean
          moon_ai_phase: boolean
          moon_ai_sign: boolean
          moon_carousel_size: string
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
          remembered_question: string | null
          resting_opacity: number
          rising_sign: string | null
          role: string
          saved_themes: Json
          show_labels: boolean
          show_question_prompt: boolean
          show_reversals: boolean
          spread_entry_modes: Json
          subscription_type: string
          sun_sign: string | null
          tarotpulse_import_done: boolean
          timezone: string | null
          track_reversals: boolean
          tz_mode: string
          ui_density: number
          updated_at: string
          user_id: string
        }
        Insert: {
          accent?: string
          accent_color?: string | null
          active_guide_id?: string | null
          active_theme_slot?: number | null
          admin_note?: string | null
          ai_blocked?: boolean
          ai_blocked_reason?: string | null
          ai_tone?: string
          allow_reversed_cards?: boolean
          archive_deepening_unlocked?: boolean
          bg_gradient_from?: string | null
          bg_gradient_to?: string | null
          birth_date?: string | null
          birth_place?: string | null
          birth_time?: string | null
          card_back?: string
          community_theme?: string | null
          custom_draw_count?: number | null
          default_life_area?: string
          default_share_color?: string
          default_spread?: string
          dismissed_hints?: Json
          display_name?: string | null
          gifted_by?: string | null
          guide_facets?: string[] | null
          guide_lens?: string | null
          heading_font?: string | null
          heading_font_size?: number | null
          initial_intention?: string | null
          is_premium?: boolean
          last_share_level?: string | null
          memory_ai_permission?: boolean
          moon_ai_phase?: boolean
          moon_ai_sign?: boolean
          moon_carousel_size?: string
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
          remembered_question?: string | null
          resting_opacity?: number
          rising_sign?: string | null
          role?: string
          saved_themes?: Json
          show_labels?: boolean
          show_question_prompt?: boolean
          show_reversals?: boolean
          spread_entry_modes?: Json
          subscription_type?: string
          sun_sign?: string | null
          tarotpulse_import_done?: boolean
          timezone?: string | null
          track_reversals?: boolean
          tz_mode?: string
          ui_density?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          accent?: string
          accent_color?: string | null
          active_guide_id?: string | null
          active_theme_slot?: number | null
          admin_note?: string | null
          ai_blocked?: boolean
          ai_blocked_reason?: string | null
          ai_tone?: string
          allow_reversed_cards?: boolean
          archive_deepening_unlocked?: boolean
          bg_gradient_from?: string | null
          bg_gradient_to?: string | null
          birth_date?: string | null
          birth_place?: string | null
          birth_time?: string | null
          card_back?: string
          community_theme?: string | null
          custom_draw_count?: number | null
          default_life_area?: string
          default_share_color?: string
          default_spread?: string
          dismissed_hints?: Json
          display_name?: string | null
          gifted_by?: string | null
          guide_facets?: string[] | null
          guide_lens?: string | null
          heading_font?: string | null
          heading_font_size?: number | null
          initial_intention?: string | null
          is_premium?: boolean
          last_share_level?: string | null
          memory_ai_permission?: boolean
          moon_ai_phase?: boolean
          moon_ai_sign?: boolean
          moon_carousel_size?: string
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
          remembered_question?: string | null
          resting_opacity?: number
          rising_sign?: string | null
          role?: string
          saved_themes?: Json
          show_labels?: boolean
          show_question_prompt?: boolean
          show_reversals?: boolean
          spread_entry_modes?: Json
          subscription_type?: string
          sun_sign?: string | null
          tarotpulse_import_done?: boolean
          timezone?: string | null
          track_reversals?: boolean
          tz_mode?: string
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
      weaves: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_premium: boolean
          pattern_ids: string[]
          pattern_key: string | null
          reading_ids: string[]
          title: string
          user_id: string
          weave_type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_premium?: boolean
          pattern_ids?: string[]
          pattern_key?: string | null
          reading_ids?: string[]
          title: string
          user_id: string
          weave_type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_premium?: boolean
          pattern_ids?: string[]
          pattern_key?: string | null
          reading_ids?: string[]
          title?: string
          user_id?: string
          weave_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      seeker_usage_monthly: {
        Row: {
          ai_blocked: boolean | null
          ai_calls_lifetime: number | null
          ai_calls_this_month: number | null
          ai_cost_usd_lifetime: number | null
          ai_cost_usd_this_month: number | null
          ai_credits_used_this_month: number | null
          display_name: string | null
          email: string | null
          hit_abuse_cap_this_month: boolean | null
          hit_quota_exceeded_this_month: boolean | null
          last_call_at: string | null
          last_upload_at: string | null
          member_since: string | null
          plan: string | null
          revenue_this_month: number | null
          role: string | null
          storage_bytes_current: number | null
          storage_cost_usd_this_month: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_detect_weaves_status: {
        Args: { _max_users_per_run: number; _min_interval_seconds: number }
        Returns: {
          cooldown_active: boolean
          cooldown_remaining_seconds: number
          last_run_cap_hit: boolean
        }[]
      }
      grant_monthly_credits: { Args: never; Returns: undefined }
      has_admin_role: { Args: { _user_id: string }; Returns: boolean }
      log_admin_action: {
        Args: {
          _action: string
          _details: Json
          _target_email: string
          _target_user_id: string
        }
        Returns: string
      }
      purge_archived_readings: { Args: never; Returns: number }
      seed_default_user_tags: { Args: { _user_id: string }; Returns: undefined }
      try_acquire_detect_weaves_slot: {
        Args: { _min_interval_seconds: number }
        Returns: {
          acquired: boolean
          last_run_at: string
          retry_after_seconds: number
        }[]
      }
      weave_pattern_key: { Args: { _pattern_ids: string[] }; Returns: string }
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
