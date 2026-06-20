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
      admin_payment_actions: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          reason: string | null
          request_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          reason?: string | null
          request_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          request_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_payment_actions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "coverage_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_requests: {
        Row: {
          accepted_by: string | null
          accommodation: string | null
          accumulated_ms: number
          amount: number
          area: string
          base_amount: number | null
          billing_locked_at: string | null
          broadcast_started_at: string
          cancelled_by: string | null
          coverage_type: string
          created_at: string
          day: string
          day_index: number
          days: number
          doctor_rating_at: string | null
          doctor_rating_score: number | null
          doctor_rating_submitted: boolean
          duration_hrs: number
          end_time: string
          end_ts: number | null
          environment: string
          expired_at: string | null
          fee_pct: number
          first_started_at: string | null
          hospital: string
          id: string
          last_extended_at: string | null
          note: string | null
          paid_at: string | null
          payment_account: Json | null
          payment_due_at: string | null
          payment_extension_count: number
          payment_provider: string | null
          payment_reference: string | null
          payment_status: string | null
          payment_url: string | null
          phone: string
          pricing_version_id: string | null
          rate_snapshot: Json | null
          reminder_sent_at: string | null
          remitted_at: string | null
          requester_id: string
          requester_rating_at: string | null
          requester_rating_score: number | null
          requester_rating_submitted: boolean
          rev: number
          settled_amount: number | null
          start_time: string
          start_ts: number | null
          started_at: number | null
          status: Database["public"]["Enums"]["coverage_request_status"]
          surcharge_amount: number
          surcharge_capped_at: string | null
          total_billed_amount: number | null
          updated_at: string
        }
        Insert: {
          accepted_by?: string | null
          accommodation?: string | null
          accumulated_ms?: number
          amount?: number
          area: string
          base_amount?: number | null
          billing_locked_at?: string | null
          broadcast_started_at?: string
          cancelled_by?: string | null
          coverage_type: string
          created_at?: string
          day: string
          day_index?: number
          days?: number
          doctor_rating_at?: string | null
          doctor_rating_score?: number | null
          doctor_rating_submitted?: boolean
          duration_hrs?: number
          end_time: string
          end_ts?: number | null
          environment?: string
          expired_at?: string | null
          fee_pct?: number
          first_started_at?: string | null
          hospital: string
          id?: string
          last_extended_at?: string | null
          note?: string | null
          paid_at?: string | null
          payment_account?: Json | null
          payment_due_at?: string | null
          payment_extension_count?: number
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          payment_url?: string | null
          phone?: string
          pricing_version_id?: string | null
          rate_snapshot?: Json | null
          reminder_sent_at?: string | null
          remitted_at?: string | null
          requester_id: string
          requester_rating_at?: string | null
          requester_rating_score?: number | null
          requester_rating_submitted?: boolean
          rev?: number
          settled_amount?: number | null
          start_time: string
          start_ts?: number | null
          started_at?: number | null
          status?: Database["public"]["Enums"]["coverage_request_status"]
          surcharge_amount?: number
          surcharge_capped_at?: string | null
          total_billed_amount?: number | null
          updated_at?: string
        }
        Update: {
          accepted_by?: string | null
          accommodation?: string | null
          accumulated_ms?: number
          amount?: number
          area?: string
          base_amount?: number | null
          billing_locked_at?: string | null
          broadcast_started_at?: string
          cancelled_by?: string | null
          coverage_type?: string
          created_at?: string
          day?: string
          day_index?: number
          days?: number
          doctor_rating_at?: string | null
          doctor_rating_score?: number | null
          doctor_rating_submitted?: boolean
          duration_hrs?: number
          end_time?: string
          end_ts?: number | null
          environment?: string
          expired_at?: string | null
          fee_pct?: number
          first_started_at?: string | null
          hospital?: string
          id?: string
          last_extended_at?: string | null
          note?: string | null
          paid_at?: string | null
          payment_account?: Json | null
          payment_due_at?: string | null
          payment_extension_count?: number
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          payment_url?: string | null
          phone?: string
          pricing_version_id?: string | null
          rate_snapshot?: Json | null
          reminder_sent_at?: string | null
          remitted_at?: string | null
          requester_id?: string
          requester_rating_at?: string | null
          requester_rating_score?: number | null
          requester_rating_submitted?: boolean
          rev?: number
          settled_amount?: number | null
          start_time?: string
          start_ts?: number | null
          started_at?: number | null
          status?: Database["public"]["Enums"]["coverage_request_status"]
          surcharge_amount?: number
          surcharge_capped_at?: string | null
          total_billed_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_requests_pricing_version_id_fkey"
            columns: ["pricing_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      doctor_presence: {
        Row: {
          last_seen: string
          lat: number | null
          left: number
          lng: number | null
          online: boolean
          top: number
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen?: string
          lat?: number | null
          left?: number
          lng?: number | null
          online?: boolean
          top?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen?: string
          lat?: number | null
          left?: number
          lng?: number | null
          online?: boolean
          top?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempts: number
          audience: string
          body: string
          created_at: string
          delivered_at: string | null
          entity_id: string
          id: string
          kind: string
          last_error: string | null
          next_attempt_at: string
          occurred_at: number
          payload: Json
          title: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          attempts?: number
          audience: string
          body: string
          created_at?: string
          delivered_at?: string | null
          entity_id: string
          id?: string
          kind: string
          last_error?: string | null
          next_attempt_at?: string
          occurred_at: number
          payload?: Json
          title: string
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          attempts?: number
          audience?: string
          body?: string
          created_at?: string
          delivered_at?: string | null
          entity_id?: string
          id?: string
          kind?: string
          last_error?: string | null
          next_attempt_at?: string
          occurred_at?: number
          payload?: Json
          title?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      payment_surcharge_log: {
        Row: {
          applied_at: string
          block_amount: number
          block_index: number
          id: string
          request_id: string
          running_total: number
          source: string
        }
        Insert: {
          applied_at?: string
          block_amount: number
          block_index: number
          id?: string
          request_id: string
          running_total: number
          source?: string
        }
        Update: {
          applied_at?: string
          block_amount?: number
          block_index?: number
          id?: string
          request_id?: string
          running_total?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_surcharge_log_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "coverage_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_underpayments: {
        Row: {
          expected_amount: number
          id: string
          payment_reference: string
          raw: Json | null
          received_amount: number
          received_at: string
          request_id: string | null
        }
        Insert: {
          expected_amount: number
          id?: string
          payment_reference: string
          raw?: Json | null
          received_amount: number
          received_at?: string
          request_id?: string | null
        }
        Update: {
          expected_amount?: number
          id?: string
          payment_reference?: string
          raw?: Json | null
          received_amount?: number
          received_at?: string
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_underpayments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "coverage_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_flats: {
        Row: {
          amount: number
          id: string
          product: string
          version_id: string
        }
        Insert: {
          amount: number
          id?: string
          product: string
          version_id: string
        }
        Update: {
          amount?: number
          id?: string
          product?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_flats_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_modifiers: {
        Row: {
          id: string
          key: string
          value: number
          version_id: string
        }
        Insert: {
          id?: string
          key: string
          value: number
          version_id: string
        }
        Update: {
          id?: string
          key?: string
          value?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_modifiers_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rates: {
        Row: {
          id: string
          rate_day: number
          rate_night: number
          tier: string
          version_id: string
        }
        Insert: {
          id?: string
          rate_day: number
          rate_night: number
          tier: string
          version_id: string
        }
        Update: {
          id?: string
          rate_day?: number
          rate_night?: number
          tier?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rates_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_versions: {
        Row: {
          created_at: string
          created_by: string | null
          effective_at: string
          id: string
          is_active: boolean
          label: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_at?: string
          id?: string
          is_active?: boolean
          label: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_at?: string
          id?: string
          is_active?: boolean
          label?: string
          notes?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_restricted_at: string | null
          account_restricted_by: string | null
          account_restricted_reason: string | null
          bank_account: string | null
          bank_account_name: string | null
          bank_name: string | null
          created_at: string
          full_name: string | null
          gender: string | null
          id: string
          last_seen_at: string | null
          license_name: string | null
          location: string | null
          mdcn: string | null
          monnify_sub_account_code: string | null
          nysc_name: string | null
          onboarded_at: string | null
          onboarded_cover_at: string | null
          onboarded_request_at: string | null
          payment_flagged_at: string | null
          payment_flagged_reason: string | null
          payment_restricted_at: string | null
          phone: string | null
          role: string | null
          selfie_url: string | null
          trust_snapshot: Json | null
          trust_snapshot_at: string | null
          updated_at: string
          verification_action_at: string | null
          verification_action_note: string | null
          verification_action_reason: string | null
          verification_action_target: string | null
          verification_receipt_url: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: string | null
        }
        Insert: {
          account_restricted_at?: string | null
          account_restricted_by?: string | null
          account_restricted_reason?: string | null
          bank_account?: string | null
          bank_account_name?: string | null
          bank_name?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          id: string
          last_seen_at?: string | null
          license_name?: string | null
          location?: string | null
          mdcn?: string | null
          monnify_sub_account_code?: string | null
          nysc_name?: string | null
          onboarded_at?: string | null
          onboarded_cover_at?: string | null
          onboarded_request_at?: string | null
          payment_flagged_at?: string | null
          payment_flagged_reason?: string | null
          payment_restricted_at?: string | null
          phone?: string | null
          role?: string | null
          selfie_url?: string | null
          trust_snapshot?: Json | null
          trust_snapshot_at?: string | null
          updated_at?: string
          verification_action_at?: string | null
          verification_action_note?: string | null
          verification_action_reason?: string | null
          verification_action_target?: string | null
          verification_receipt_url?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          years_experience?: string | null
        }
        Update: {
          account_restricted_at?: string | null
          account_restricted_by?: string | null
          account_restricted_reason?: string | null
          bank_account?: string | null
          bank_account_name?: string | null
          bank_name?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          id?: string
          last_seen_at?: string | null
          license_name?: string | null
          location?: string | null
          mdcn?: string | null
          monnify_sub_account_code?: string | null
          nysc_name?: string | null
          onboarded_at?: string | null
          onboarded_cover_at?: string | null
          onboarded_request_at?: string | null
          payment_flagged_at?: string | null
          payment_flagged_reason?: string | null
          payment_restricted_at?: string | null
          phone?: string | null
          role?: string | null
          selfie_url?: string | null
          trust_snapshot?: Json | null
          trust_snapshot_at?: string | null
          updated_at?: string
          verification_action_at?: string | null
          verification_action_note?: string | null
          verification_action_reason?: string | null
          verification_action_target?: string | null
          verification_receipt_url?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          years_experience?: string | null
        }
        Relationships: []
      }
      ratings: {
        Row: {
          created_at: string
          feedback: string | null
          id: string
          ratee_entity_id: string
          rater_user_id: string
          score: number
          shift_id: string
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          id?: string
          ratee_entity_id: string
          rater_user_id: string
          score: number
          shift_id: string
        }
        Update: {
          created_at?: string
          feedback?: string | null
          id?: string
          ratee_entity_id?: string
          rater_user_id?: string
          score?: number
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "coverage_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_segments: {
        Row: {
          billed_amount: number | null
          billed_minutes: number | null
          created_at: string
          day_index: number
          ended_at: string | null
          id: string
          payment_reference: string | null
          request_id: string
          segment_index: number
          settled_at: string | null
          started_at: string
        }
        Insert: {
          billed_amount?: number | null
          billed_minutes?: number | null
          created_at?: string
          day_index?: number
          ended_at?: string | null
          id?: string
          payment_reference?: string | null
          request_id: string
          segment_index: number
          settled_at?: string | null
          started_at: string
        }
        Update: {
          billed_amount?: number | null
          billed_minutes?: number | null
          created_at?: string
          day_index?: number
          ended_at?: string | null
          id?: string
          payment_reference?: string | null
          request_id?: string
          segment_index?: number
          settled_at?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_segments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "coverage_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      trust_blocks: {
        Row: {
          block_index: number
          created_at: string
          from_at: string
          id: string
          kind: string
          payload: Json
          to_at: string
          user_id: string
        }
        Insert: {
          block_index: number
          created_at?: string
          from_at: string
          id?: string
          kind: string
          payload: Json
          to_at: string
          user_id: string
        }
        Update: {
          block_index?: number
          created_at?: string
          from_at?: string
          id?: string
          kind?: string
          payload?: Json
          to_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_blocks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _active_pricing_version_id: { Args: never; Returns: string }
      _auto_advance_day_boundary: { Args: never; Returns: Json }
      _bill_segment: {
        Args: { _env: string; _kind: string; _seg_id: string }
        Returns: number
      }
      _booked_per_day_min: {
        Args: { _end_hhmm: string; _start_hhmm: string }
        Returns: number
      }
      _build_locked_snapshot: {
        Args: {
          _coverage_type: string
          _days: number
          _end_hhmm: string
          _environment: string
          _start_hhmm: string
        }
        Returns: Json
      }
      _classify_product: {
        Args: { _coverage_type: string; _days: number }
        Returns: string
      }
      _hhmm_to_min: { Args: { _s: string }; Returns: number }
      _price_segment_locked: {
        Args: { _snapshot: Json; _worked_min: number }
        Returns: {
          amount: number
          billable_min: number
          tolerance_fired: boolean
        }[]
      }
      _price_standard_day: {
        Args: {
          _block_min: number
          _booked_per_day_min: number
          _busy_mult: number
          _day_window_min: number
          _first_hour_min: number
          _night_window_min: number
          _rate_day: number
          _rate_night: number
          _tolerance_min: number
          _worked_min: number
        }
        Returns: {
          amount: number
          billable_min: number
          tolerance_fired: boolean
        }[]
      }
      _pricing_flat: {
        Args: { _product: string; _version: string }
        Returns: number
      }
      _pricing_modifier: {
        Args: { _key: string; _version: string }
        Returns: number
      }
      _pricing_rate: {
        Args: { _tier: string; _version: string }
        Returns: {
          rate_day: number
          rate_night: number
        }[]
      }
      _round_billable_minutes: { Args: { _worked: number }; Returns: number }
      _split_day_night_minutes: {
        Args: { _end: string; _start: string }
        Returns: {
          day_min: number
          night_min: number
        }[]
      }
      _tier_for_per_day_hours: { Args: { _booked_hr: number }; Returns: string }
      _trust_ratings_received: {
        Args: { _user_id: string }
        Returns: {
          created_at: string
          score: number
        }[]
      }
      _trust_terminal_shifts: {
        Args: { _role: string; _user_id: string }
        Returns: {
          outcome: string
          shift_id: string
          terminal_at: string
        }[]
      }
      _window_day_night_min: {
        Args: { _end_hhmm: string; _start_hhmm: string }
        Returns: {
          day_min: number
          night_min: number
        }[]
      }
      admin_apply_payment_restriction: {
        Args: { _reason?: string; _user_id: string }
        Returns: Json
      }
      admin_apply_trust_restriction: {
        Args: { _reason?: string; _user_id: string }
        Returns: Json
      }
      admin_clear_payment_flag: {
        Args: { _reason?: string; _user_id: string }
        Returns: Json
      }
      admin_clear_payment_restriction: {
        Args: { _reason?: string; _user_id: string }
        Returns: Json
      }
      admin_clear_trust_restriction: {
        Args: { _user_id: string }
        Returns: Json
      }
      admin_list_flagged_accounts: { Args: never; Returns: Json }
      admin_list_trust: {
        Args: { _limit?: number; _only_flagged?: boolean }
        Returns: {
          full_name: string
          role: string
          snapshot: Json
          user_id: string
        }[]
      }
      admin_list_users: {
        Args: { _limit?: number; _offset?: number }
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          last_seen_at: string
          location: string
          onboarded_cover_at: string
          onboarded_request_at: string
          phone: string
          role: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }[]
      }
      admin_mark_no_show: {
        Args: { _reason?: string; _request_id: string }
        Returns: Json
      }
      admin_overview_stats: { Args: never; Returns: Json }
      admin_publish_pricing_version: {
        Args: {
          _flats: Json
          _label: string
          _modifiers: Json
          _notes?: string
          _rates: Json
        }
        Returns: string
      }
      admin_risk_overview: { Args: { _days?: number }; Returns: Json }
      admin_system_health: { Args: never; Returns: Json }
      claim_coverage_request: {
        Args: { _request_id: string }
        Returns: boolean
      }
      claim_first_admin: { Args: never; Returns: boolean }
      clear_payment_flag_on_settlement: {
        Args: { _request_id: string }
        Returns: undefined
      }
      compute_quote: {
        Args: {
          _coverage_kind?: string
          _end: string
          _environment?: string
          _start: string
        }
        Returns: Json
      }
      current_user_is_approved_doctor: { Args: never; Returns: boolean }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      dispatch_email_queue_processing: { Args: never; Returns: undefined }
      doctor_resubmit_verification: { Args: never; Returns: boolean }
      drain_surcharge_due: { Args: never; Returns: Json }
      email_queue_depth: {
        Args: never
        Returns: {
          depth: number
          oldest_enqueued_at: string
          queue_name: string
        }[]
      }
      end_shift: { Args: { _request_id: string }; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_request: { Args: { _id: string }; Returns: Json }
      expire_stale_doctor_presence: { Args: never; Returns: number }
      expire_stale_searching_requests: { Args: never; Returns: undefined }
      extend_payment_window: { Args: { _request_id: string }; Returns: Json }
      get_assigned_doctor_profile: {
        Args: { _doctor: string }
        Returns: {
          full_name: string
          gender: string
          id: string
          mdcn: string
          selfie_url: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: string
        }[]
      }
      get_my_payment_restriction: { Args: never; Returns: Json }
      get_rating: {
        Args: { _entity_id: string }
        Returns: {
          count: number
          score: number
        }[]
      }
      get_reliability: {
        Args: { _entity_id: string }
        Returns: {
          completed: number
          total: number
        }[]
      }
      get_request_billing_state: {
        Args: { _request_id: string }
        Returns: Json
      }
      get_request_phone: { Args: { _request_id: string }; Returns: string }
      get_shift_rating_state: { Args: { _request_id: string }; Returns: Json }
      get_trust: { Args: { _user_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_assigned_doctor_of: {
        Args: { _doctor: string; _requester: string }
        Returns: boolean
      }
      list_my_request_phones: {
        Args: never
        Returns: {
          id: string
          phone: string
        }[]
      }
      list_online_approved_doctors: {
        Args: never
        Returns: {
          last_seen: string
          lat: number
          left: number
          lng: number
          online: boolean
          top: number
          user_id: string
        }[]
      }
      list_open_coverage_requests: {
        Args: never
        Returns: {
          accepted_by: string | null
          accommodation: string | null
          accumulated_ms: number
          amount: number
          area: string
          base_amount: number | null
          billing_locked_at: string | null
          broadcast_started_at: string
          cancelled_by: string | null
          coverage_type: string
          created_at: string
          day: string
          day_index: number
          days: number
          doctor_rating_at: string | null
          doctor_rating_score: number | null
          doctor_rating_submitted: boolean
          duration_hrs: number
          end_time: string
          end_ts: number | null
          environment: string
          expired_at: string | null
          fee_pct: number
          first_started_at: string | null
          hospital: string
          id: string
          last_extended_at: string | null
          note: string | null
          paid_at: string | null
          payment_account: Json | null
          payment_due_at: string | null
          payment_extension_count: number
          payment_provider: string | null
          payment_reference: string | null
          payment_status: string | null
          payment_url: string | null
          phone: string
          pricing_version_id: string | null
          rate_snapshot: Json | null
          reminder_sent_at: string | null
          remitted_at: string | null
          requester_id: string
          requester_rating_at: string | null
          requester_rating_score: number | null
          requester_rating_submitted: boolean
          rev: number
          settled_amount: number | null
          start_time: string
          start_ts: number | null
          started_at: number | null
          status: Database["public"]["Enums"]["coverage_request_status"]
          surcharge_amount: number
          surcharge_capped_at: string | null
          total_billed_amount: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "coverage_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_settlement_paid: {
        Args: { _amount: number; _payment_reference: string }
        Returns: boolean
      }
      mark_settlement_remitted: {
        Args: { _amount: number; _payment_reference: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      pause_shift: { Args: { _request_id: string }; Returns: Json }
      prune_email_send_log: { Args: { _retain_days?: number }; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recompute_trust: { Args: { _user_id: string }; Returns: Json }
      resume_shift: { Args: { _request_id: string }; Returns: Json }
      server_now: { Args: never; Returns: string }
      start_shift: { Args: { _request_id: string }; Returns: Json }
      submit_shift_rating: {
        Args: { _feedback?: string; _request_id: string; _score: number }
        Returns: Json
      }
      touch_last_seen: { Args: never; Returns: undefined }
      validate_shift_schedule: {
        Args: { _end: string; _start: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      coverage_request_status:
        | "searching"
        | "accepted"
        | "active"
        | "paused"
        | "completed"
        | "cancelled"
        | "expired"
        | "no_show"
        | "awaiting_payment"
      verification_status:
        | "pending"
        | "approved"
        | "suspended"
        | "rejected"
        | "action_required"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
      coverage_request_status: [
        "searching",
        "accepted",
        "active",
        "paused",
        "completed",
        "cancelled",
        "expired",
        "no_show",
        "awaiting_payment",
      ],
      verification_status: [
        "pending",
        "approved",
        "suspended",
        "rejected",
        "action_required",
      ],
    },
  },
} as const
