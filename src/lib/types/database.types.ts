export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      personas: {
        Row: {
          id: string
          user_id: string | null
          type: string
          name: string
          icon: string
          color: string
          is_system: boolean
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          type: string
          name: string
          icon: string
          color: string
          is_system?: boolean
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          type?: string
          name?: string
          icon?: string
          color?: string
          is_system?: boolean
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      domains: {
        Row: {
          id: string
          user_id: string
          name: string
          icon: string | null
          description: string | null
          sort_order: number
          settings: Json
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          icon?: string | null
          description?: string | null
          sort_order?: number
          settings?: Json
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          icon?: string | null
          description?: string | null
          sort_order?: number
          settings?: Json
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      cabinets: {
        Row: {
          id: string
          domain_id: string
          parent_id: string | null
          name: string
          sort_order: number
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Insert: {
          id?: string
          domain_id: string
          parent_id?: string | null
          name: string
          sort_order?: number
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          domain_id?: string
          parent_id?: string | null
          name?: string
          sort_order?: number
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cabinets_domain_id_fkey'
            columns: ['domain_id']
            isOneToOne: false
            referencedRelation: 'domains'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cabinets_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'cabinets'
            referencedColumns: ['id']
          },
        ]
      }
      streams: {
        Row: {
          id: string
          cabinet_id: string | null
          domain_id?: string | null
          name: string
          description?: string | null
          sort_order: number
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Insert: {
          id?: string
          cabinet_id: string | null
          domain_id?: string | null
          name: string
          description?: string | null
          sort_order?: number
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          cabinet_id?: string | null
          domain_id?: string | null
          name?: string
          description?: string | null
          sort_order?: number
          deleted_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'streams_cabinet_id_fkey'
            columns: ['cabinet_id']
            isOneToOne: false
            referencedRelation: 'cabinets'
            referencedColumns: ['id']
          },
        ]
      }
      entries: {
        Row: {
          id: string
          stream_id: string
          is_draft?: boolean
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Insert: {
          id?: string
          stream_id: string
          is_draft?: boolean
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          stream_id?: string
          is_draft?: boolean
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'entries_stream_id_fkey'
            columns: ['stream_id']
            isOneToOne: false
            referencedRelation: 'streams'
            referencedColumns: ['id']
          },
        ]
      }
      sections: {
        Row: {
          id: string
          entry_id: string
          persona_id: string | null
          persona_name_snapshot: string | null
          content_json: Json | null
          search_text: string | null
          sort_order: number
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Insert: {
          id?: string
          entry_id: string
          persona_id?: string | null
          persona_name_snapshot?: string | null
          content_json?: Json | null
          search_text?: string | null
          sort_order?: number
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          entry_id?: string
          persona_id?: string | null
          persona_name_snapshot?: string | null
          content_json?: Json | null
          search_text?: string | null
          sort_order?: number
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'sections_entry_id_fkey'
            columns: ['entry_id']
            isOneToOne: false
            referencedRelation: 'entries'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sections_persona_id_fkey'
            columns: ['persona_id']
            isOneToOne: false
            referencedRelation: 'personas'
            referencedColumns: ['id']
          },
        ]
      }
      canvases: {
        Row: {
          id: string
          stream_id: string
          content_json: Json | null
          search_text: string | null
          version: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Insert: {
          id?: string
          stream_id: string
          content_json?: Json | null
          search_text?: string | null
          version?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          stream_id?: string
          content_json?: Json | null
          search_text?: string | null
          version?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'canvases_stream_id_fkey'
            columns: ['stream_id']
            isOneToOne: false
            referencedRelation: 'streams'
            referencedColumns: ['id']
          },
        ]
      }
      canvas_versions: {
        Row: {
          id: string
          canvas_id: string
          content_json: Json | null
          version: number | null
          created_at?: string | null
          name?: string | null
        }
        Insert: {
          id?: string
          canvas_id: string
          content_json?: Json | null
          version?: number | null
          created_at?: string | null
        }
        Update: {
          id?: string
          canvas_id?: string
          content_json?: Json | null
          version?: number | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'canvas_versions_canvas_id_fkey'
            columns: ['canvas_id']
            isOneToOne: false
            referencedRelation: 'canvases'
            referencedColumns: ['id']
          },
        ]
      }
      audit_logs: {
        Row: {
          id: string
          user_id: string | null
          action: string
          metadata: Json | null
          target_table?: string | null
          target_id?: string | null
          payload?: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          metadata?: Json | null
          target_table?: string | null
          target_id?: string | null
          payload?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          action?: string
          metadata?: Json | null
          target_table?: string | null
          target_id?: string | null
          payload?: Json | null
          created_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      exec_sql: { Args: { sql: string }; Returns: undefined }
      create_entry_with_section: {
        Args: {
          p_stream_id: string
          p_persona_id?: string | null
          p_persona_name_snapshot?: string | null
          p_content_json: Json
          p_search_text?: string | null
          p_sort_order?: number | null
          p_is_draft?: boolean
        }
        Returns: {
          entry_id: string
          section_id: string
        }[]
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

