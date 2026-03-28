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
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          expires_at: string | null
          id: string
          payload: Json | null
          target_id: string | null
          target_table: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          payload?: Json | null
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          payload?: Json | null
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      branches: {
        Row: {
          created_at: string | null
          head_commit_id: string | null
          id: string
          name: string
          stream_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          head_commit_id?: string | null
          id?: string
          name: string
          stream_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          head_commit_id?: string | null
          id?: string
          name?: string
          stream_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_head_commit_id_fkey"
            columns: ["head_commit_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      cabinets: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          domain_id: string
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          domain_id: string
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          domain_id?: string
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cabinets_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cabinets_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cabinets"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_versions: {
        Row: {
          canvas_id: string
          content_format: string
          content_json: Json
          created_at: string | null
          created_by: string | null
          id: string
          name: string | null
          raw_markdown: string
          stream_id: string
          summary: string | null
        }
        Insert: {
          canvas_id: string
          content_format?: string
          content_json?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string | null
          raw_markdown?: string
          stream_id: string
          summary?: string | null
        }
        Update: {
          canvas_id?: string
          content_format?: string
          content_json?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string | null
          raw_markdown?: string
          stream_id?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "canvas_versions_canvas_id_fkey"
            columns: ["canvas_id"]
            isOneToOne: false
            referencedRelation: "canvases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvas_versions_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      canvases: {
        Row: {
          content_format: string
          content_json: Json
          created_at: string | null
          id: string
          raw_markdown: string
          stream_id: string
          updated_at: string | null
        }
        Insert: {
          content_format?: string
          content_json?: Json
          created_at?: string | null
          id?: string
          raw_markdown?: string
          stream_id: string
          updated_at?: string | null
        }
        Update: {
          content_format?: string
          content_json?: Json
          created_at?: string | null
          id?: string
          raw_markdown?: string
          stream_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "canvases_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: true
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      commit_branches: {
        Row: {
          branch_id: string
          commit_id: string
        }
        Insert: {
          branch_id: string
          commit_id: string
        }
        Update: {
          branch_id?: string
          commit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commit_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commit_branches_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          chunk_markdown: string
          chunk_metadata: Json
          created_at: string
          document_id: string
          heading_path: Json
          id: string
          page_end: number | null
          page_start: number | null
          stream_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          chunk_markdown: string
          chunk_metadata?: Json
          created_at?: string
          document_id: string
          heading_path?: Json
          id?: string
          page_end?: number | null
          page_start?: number | null
          stream_id: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          chunk_markdown?: string
          chunk_metadata?: Json
          created_at?: string
          document_id?: string
          heading_path?: Json
          id?: string
          page_end?: number | null
          page_start?: number | null
          stream_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      document_entry_links: {
        Row: {
          created_at: string
          document_id: string
          entry_id: string
          relationship_type: string
        }
        Insert: {
          created_at?: string
          document_id: string
          entry_id: string
          relationship_type?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          entry_id?: string
          relationship_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_entry_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_entry_links_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      document_import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          document_id: string
          error_message: string | null
          eta_seconds: number | null
          id: string
          parser_config: Json
          progress_message: string | null
          progress_percent: number | null
          provider: string
          retry_count: number
          started_at: string | null
          status: string
          stream_id: string
          updated_at: string
          warning_messages: Json
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          document_id: string
          error_message?: string | null
          eta_seconds?: number | null
          id?: string
          parser_config?: Json
          progress_message?: string | null
          progress_percent?: number | null
          provider?: string
          retry_count?: number
          started_at?: string | null
          status?: string
          stream_id: string
          updated_at?: string
          warning_messages?: Json
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string
          error_message?: string | null
          eta_seconds?: number | null
          id?: string
          parser_config?: Json
          progress_message?: string | null
          progress_percent?: number | null
          provider?: string
          retry_count?: number
          started_at?: string | null
          status?: string
          stream_id?: string
          updated_at?: string
          warning_messages?: Json
        }
        Relationships: [
          {
            foreignKeyName: "document_import_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_import_jobs_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content_type: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          extracted_markdown: string | null
          extraction_metadata: Json
          file_size_bytes: number | null
          id: string
          import_status: string
          original_filename: string
          source_metadata: Json
          storage_bucket: string
          storage_path: string
          stream_id: string
          thumbnail_error: string | null
          thumbnail_path: string | null
          thumbnail_status: string
          thumbnail_updated_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          content_type: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          extracted_markdown?: string | null
          extraction_metadata?: Json
          file_size_bytes?: number | null
          id?: string
          import_status?: string
          original_filename: string
          source_metadata?: Json
          storage_bucket?: string
          storage_path: string
          stream_id: string
          thumbnail_error?: string | null
          thumbnail_path?: string | null
          thumbnail_status?: string
          thumbnail_updated_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          content_type?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          extracted_markdown?: string | null
          extraction_metadata?: Json
          file_size_bytes?: number | null
          id?: string
          import_status?: string
          original_filename?: string
          source_metadata?: Json
          storage_bucket?: string
          storage_path?: string
          stream_id?: string
          thumbnail_error?: string | null
          thumbnail_path?: string | null
          thumbnail_status?: string
          thumbnail_updated_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          description: string | null
          icon: string
          id: string
          name: string
          settings: Json | null
          sort_order: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          icon: string
          id?: string
          name: string
          settings?: Json | null
          sort_order?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          icon?: string
          id?: string
          name?: string
          settings?: Json | null
          sort_order?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      entries: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          id: string
          is_draft: boolean
          parent_commit_id: string | null
          stream_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_draft?: boolean
          parent_commit_id?: string | null
          stream_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_draft?: boolean
          parent_commit_id?: string | null
          stream_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entries_parent_commit_id_fkey"
            columns: ["parent_commit_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          color: string
          created_at: string | null
          deleted_at: string | null
          icon: string
          id: string
          is_shadow: boolean
          is_system: boolean | null
          name: string
          shadow_document_id: string | null
          shadow_stream_id: string | null
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          color: string
          created_at?: string | null
          deleted_at?: string | null
          icon: string
          id?: string
          is_shadow?: boolean
          is_system?: boolean | null
          name: string
          shadow_document_id?: string | null
          shadow_stream_id?: string | null
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          deleted_at?: string | null
          icon?: string
          id?: string
          is_shadow?: boolean
          is_system?: boolean | null
          name?: string
          shadow_document_id?: string | null
          shadow_stream_id?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personas_shadow_document_id_fkey"
            columns: ["shadow_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personas_shadow_stream_id_fkey"
            columns: ["shadow_stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
        ]
      }
      section_attachments: {
        Row: {
          annotation_text: string | null
          created_at: string
          document_id: string
          id: string
          referenced_page: number | null
          referenced_persona_id: string | null
          section_id: string
          sort_order: number
          title_snapshot: string | null
          updated_at: string
        }
        Insert: {
          annotation_text?: string | null
          created_at?: string
          document_id: string
          id?: string
          referenced_page?: number | null
          referenced_persona_id?: string | null
          section_id: string
          sort_order?: number
          title_snapshot?: string | null
          updated_at?: string
        }
        Update: {
          annotation_text?: string | null
          created_at?: string
          document_id?: string
          id?: string
          referenced_page?: number | null
          referenced_persona_id?: string | null
          section_id?: string
          sort_order?: number
          title_snapshot?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_pdf_attachments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_pdf_attachments_referenced_persona_id_fkey"
            columns: ["referenced_persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_pdf_attachments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          content_format: string
          content_json: Json
          created_at: string | null
          entry_id: string
          file_display_mode: string
          id: string
          persona_id: string | null
          persona_name_snapshot: string | null
          raw_markdown: string
          search_text: string | null
          section_type: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          content_format?: string
          content_json?: Json
          created_at?: string | null
          entry_id: string
          file_display_mode?: string
          id?: string
          persona_id?: string | null
          persona_name_snapshot?: string | null
          raw_markdown?: string
          search_text?: string | null
          section_type?: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          content_format?: string
          content_json?: Json
          created_at?: string | null
          entry_id?: string
          file_display_mode?: string
          id?: string
          persona_id?: string | null
          persona_name_snapshot?: string | null
          raw_markdown?: string
          search_text?: string | null
          section_type?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sections_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      streams: {
        Row: {
          cabinet_id: string | null
          created_at: string | null
          deleted_at: string | null
          domain_id: string
          id: string
          name: string
          sort_order: number
          stream_kind: string
          updated_at: string | null
        }
        Insert: {
          cabinet_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          domain_id: string
          id?: string
          name: string
          sort_order?: number
          stream_kind?: string
          updated_at?: string | null
        }
        Update: {
          cabinet_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          domain_id?: string
          id?: string
          name?: string
          sort_order?: number
          stream_kind?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "streams_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ui_preferences: {
        Row: {
          created_at: string
          preferences: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          preferences?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          preferences?: Json
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
      apply_audit_inverse: {
        Args: { payload: Json; target_id: string; target_table: string }
        Returns: undefined
      }
      cleanup_unused_shadow_persona: {
        Args: { p_persona_id: string }
        Returns: undefined
      }
      create_entry_with_section:
        | {
            Args: {
              p_content_json: Json
              p_persona_id?: string
              p_persona_name_snapshot?: string
              p_stream_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_content_json: Json
              p_is_draft?: boolean
              p_persona_id?: string
              p_persona_name_snapshot?: string
              p_stream_id: string
            }
            Returns: Json
          }
      duplicate_domain: {
        Args: {
          p_new_name: string
          p_new_user_id: string
          p_orig_domain_id: string
        }
        Returns: string
      }
      exec_sql: { Args: { sql: string }; Returns: undefined }
      get_domain_stats: {
        Args: { p_user_id: string }
        Returns: {
          cabinet_count: number
          domain_id: string
          entry_count: number
          stream_count: number
        }[]
      }
      jsonb_to_text: { Args: { jsonb_data: Json }; Returns: string }
      markdown_to_search_text: { Args: { markdown: string }; Returns: string }
      revert_bridge_action: { Args: { audit_id: string }; Returns: undefined }
      search_canvases: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          content_preview: string
          domain_icon: string
          domain_id: string
          domain_name: string
          id: string
          stream_id: string
          stream_name: string
          updated_at: string
        }[]
      }
      user_can_access_stream: {
        Args: { p_stream_id: string }
        Returns: boolean
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

