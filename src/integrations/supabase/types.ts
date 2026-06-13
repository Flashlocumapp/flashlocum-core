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
      coverage_requests: {
        Row: {
          accepted_by: string | null
          accommodation: string | null
          accumulated_ms: number
          amount: number
          area: string
          cancelled_by: string | null
          coverage_type: string
          created_at: string
          day: string
          day_index: number
          days: number
          duration_hrs: number
          end_time: string
          end_ts: number | null
          fee_pct: number
          hospital: string
          id: string
          note: string | null
          paid_at: string | null
          payment_provider: string | null
          payment_reference: string | null
          payment_status: string | null
          payment_url: string | null
          phone: string
          remitted_at: string | null
          requester_id: string
          settled_amount: number | null
          start_time: string
          start_ts: number | null
          started_at: number | null
          status: Database["public"]["Enums"]["coverage_request_status"]
          updated_at: string
        }
        Insert: {
          accepted_by?: string | null
          accommodation?: string | null
          accumulated_ms?: number
          amount?: number
          area: string
          cancelled_by?: string | null
          coverage_type: string
          created_at?: string
          day: string
          day_index?: number
          days?: number
          duration_hrs?: number
          end_time: string
          end_ts?: number | null
          fee_pct?: number
          hospital: string
          id?: string
          note?: string | null
          paid_at?: string | null
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          payment_url?: string | null
          phone?: string
          remitted_at?: string | null
          requester_id: string
          settled_amount?: number | null
          start_time: string
          start_ts?: number | null
          started_at?: number | null
          status?: Database["public"]["Enums"]["coverage_request_status"]
          updated_at?: string
        }
        Update: {
          accepted_by?: string | null
          accommodation?: string | null
          accumulated_ms?: number
          amount?: number
          area?: string
          cancelled_by?: string | null
          coverage_type?: string
          created_at?: string
          day?: string
          day_index?: number
          days?: number
          duration_hrs?: number
          end_time?: string
          end_ts?: number | null
          fee_pct?: number
          hospital?: string
          id?: string
          note?: string | null
          paid_at?: string | null
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          payment_url?: string | null
          phone?: string
          remitted_at?: string | null
          requester_id?: string
          settled_amount?: number | null
          start_time?: string
          start_ts?: number | null
          started_at?: number | null
          status?: Database["public"]["Enums"]["coverage_request_status"]
          updated_at?: string
        }
        Relationships: []
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
          left: number
          online: boolean
          top: number
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen?: string
          left?: number
          online?: boolean
          top?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen?: string
          left?: number
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
      profiles: {
        Row: {
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
          phone: string | null
          role: string | null
          selfie_url: string | null
          updated_at: string
          verification_receipt_url: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: string | null
        }
        Insert: {
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
          phone?: string | null
          role?: string | null
          selfie_url?: string | null
          updated_at?: string
          verification_receipt_url?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          years_experience?: string | null
        }
        Update: {
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
          phone?: string | null
          role?: string | null
          selfie_url?: string | null
          updated_at?: string
          verification_receipt_url?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          years_experience?: string | null
        }
        Relationships: []
      }
      ratings: {
        Row: {
          created_at: string
          id: string
          ratee_entity_id: string
          rater_user_id: string
          score: number
          shift_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ratee_entity_id: string
          rater_user_id: string
          score: number
          shift_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ratee_entity_id?: string
          rater_user_id?: string
          score?: number
          shift_id?: string | null
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
      admin_list_users: {
        Args: never
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
      admin_overview_stats: { Args: never; Returns: Json }
      claim_coverage_request: {
        Args: { _request_id: string }
        Returns: boolean
      }
      claim_first_admin: { Args: never; Returns: boolean }
      current_user_is_approved_doctor: { Args: never; Returns: boolean }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_depth: {
        Args: never
        Returns: {
          depth: number
          oldest_enqueued_at: string
          queue_name: string
        }[]
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
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
      get_request_phone: { Args: { _request_id: string }; Returns: string }
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
      prune_email_send_log: { Args: { _retain_days?: number }; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      touch_last_seen: { Args: never; Returns: undefined }
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
      verification_status: "pending" | "approved" | "suspended" | "rejected"
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
      ],
      verification_status: ["pending", "approved", "suspended", "rejected"],
    },
  },
} as const
