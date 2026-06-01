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
          phone: string
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
          phone?: string
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
          phone?: string
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
      profiles: {
        Row: {
          bank_account: string | null
          bank_name: string | null
          created_at: string
          full_name: string | null
          gender: string | null
          id: string
          license_name: string | null
          mdcn: string | null
          onboarded_at: string | null
          onboarded_cover_at: string | null
          onboarded_request_at: string | null
          phone: string | null
          role: string | null
          selfie_url: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_name?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          id: string
          license_name?: string | null
          mdcn?: string | null
          onboarded_at?: string | null
          onboarded_cover_at?: string | null
          onboarded_request_at?: string | null
          phone?: string | null
          role?: string | null
          selfie_url?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          years_experience?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_name?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          id?: string
          license_name?: string | null
          mdcn?: string | null
          onboarded_at?: string | null
          onboarded_cover_at?: string | null
          onboarded_request_at?: string | null
          phone?: string | null
          role?: string | null
          selfie_url?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          years_experience?: string | null
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
      claim_first_admin: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
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
