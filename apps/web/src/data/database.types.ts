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
      announcement_comments: {
        Row: {
          announcement_id: string
          author: string | null
          body: string
          created_at: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          announcement_id: string
          author?: string | null
          body: string
          created_at?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          announcement_id?: string
          author?: string | null
          body?: string
          created_at?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcement_comments_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reactions: {
        Row: {
          announcement_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          announcement_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          announcement_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reactions_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          announcement_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          announcement_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string | null
          created_at: string | null
          created_by: string | null
          end_at: string | null
          id: string
          metadata: Json | null
          start_at: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          created_by?: string | null
          end_at?: string | null
          id?: string
          metadata?: Json | null
          start_at?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string | null
          created_by?: string | null
          end_at?: string | null
          id?: string
          metadata?: Json | null
          start_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          created_at: string | null
          id: string
          key: string | null
          metadata: Json | null
          tags: string[] | null
          uploaded_by: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          key?: string | null
          metadata?: Json | null
          tags?: string[] | null
          uploaded_by?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string | null
          metadata?: Json | null
          tags?: string[] | null
          uploaded_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string | null
          actor: string | null
          created_at: string | null
          id: string
          payload: Json | null
          resource_id: string | null
          resource_type: string | null
        }
        Insert: {
          action?: string | null
          actor?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          resource_id?: string | null
          resource_type?: string | null
        }
        Update: {
          action?: string | null
          actor?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          resource_id?: string | null
          resource_type?: string | null
        }
        Relationships: []
      }
      cash_closings: {
        Row: {
          alcance: string
          cajero: string | null
          contado: number
          corte_desde: string | null
          corte_hasta: string | null
          created_at: string | null
          created_by: string | null
          diferencia: number
          esperado: number
          fecha: string
          fondo: number
          id: string
          motivo: string | null
          op_id: string | null
          prev_closing_id: string | null
          usuario: string | null
          void_reason: string | null
          voids_closing_id: string | null
        }
        Insert: {
          alcance: string
          cajero?: string | null
          contado: number
          corte_desde?: string | null
          corte_hasta?: string | null
          created_at?: string | null
          created_by?: string | null
          diferencia: number
          esperado: number
          fecha: string
          fondo?: number
          id?: string
          motivo?: string | null
          op_id?: string | null
          prev_closing_id?: string | null
          usuario?: string | null
          void_reason?: string | null
          voids_closing_id?: string | null
        }
        Update: {
          alcance?: string
          cajero?: string | null
          contado?: number
          corte_desde?: string | null
          corte_hasta?: string | null
          created_at?: string | null
          created_by?: string | null
          diferencia?: number
          esperado?: number
          fecha?: string
          fondo?: number
          id?: string
          motivo?: string | null
          op_id?: string | null
          prev_closing_id?: string | null
          usuario?: string | null
          void_reason?: string | null
          voids_closing_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_closings_prev_closing_id_fkey"
            columns: ["prev_closing_id"]
            isOneToOne: false
            referencedRelation: "cash_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_closings_voids_closing_id_fkey"
            columns: ["voids_closing_id"]
            isOneToOne: false
            referencedRelation: "cash_closings"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_ai_tool_calls: {
        Row: {
          detalle: Json | null
          finished_at: string
          id: string
          product_ids: string[]
          round: number
          started_at: string
          status: string
          tool_name: string
          turn_id: string
        }
        Insert: {
          detalle?: Json | null
          finished_at?: string
          id?: string
          product_ids?: string[]
          round: number
          started_at?: string
          status: string
          tool_name: string
          turn_id: string
        }
        Update: {
          detalle?: Json | null
          finished_at?: string
          id?: string
          product_ids?: string[]
          round?: number
          started_at?: string
          status?: string
          tool_name?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_ai_tool_calls_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "cc_ai_turns"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_ai_turns: {
        Row: {
          attempts: number
          conversation_id: string
          created_at: string
          error_class: string | null
          evidencia: string[]
          finished_at: string | null
          id: string
          input_tokens: number | null
          intent: string | null
          lease_until: string | null
          model: string
          operation_id: string
          output_tokens: number | null
          provider: string
          result_message_id: string | null
          started_at: string
          status: string
          tool_rounds: number
          trigger_message_id: string | null
          trigger_seq: number
        }
        Insert: {
          attempts?: number
          conversation_id: string
          created_at?: string
          error_class?: string | null
          evidencia?: string[]
          finished_at?: string | null
          id?: string
          input_tokens?: number | null
          intent?: string | null
          lease_until?: string | null
          model: string
          operation_id: string
          output_tokens?: number | null
          provider: string
          result_message_id?: string | null
          started_at?: string
          status?: string
          tool_rounds?: number
          trigger_message_id?: string | null
          trigger_seq: number
        }
        Update: {
          attempts?: number
          conversation_id?: string
          created_at?: string
          error_class?: string | null
          evidencia?: string[]
          finished_at?: string | null
          id?: string
          input_tokens?: number | null
          intent?: string | null
          lease_until?: string | null
          model?: string
          operation_id?: string
          output_tokens?: number | null
          provider?: string
          result_message_id?: string | null
          started_at?: string
          status?: string
          tool_rounds?: number
          trigger_message_id?: string | null
          trigger_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "cc_ai_turns_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "cc_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_ai_turns_result_message_id_fkey"
            columns: ["result_message_id"]
            isOneToOne: false
            referencedRelation: "cc_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_ai_turns_trigger_message_id_fkey"
            columns: ["trigger_message_id"]
            isOneToOne: false
            referencedRelation: "cc_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_cart_events: {
        Row: {
          actor_profile_id: string | null
          actor_type: string
          actor_visitor_id: string | null
          cart_id: string
          created_at: string
          detalle: Json | null
          id: number
          product_id: string | null
          qty_antes: number | null
          qty_despues: number | null
          tipo: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_type: string
          actor_visitor_id?: string | null
          cart_id: string
          created_at?: string
          detalle?: Json | null
          id?: never
          product_id?: string | null
          qty_antes?: number | null
          qty_despues?: number | null
          tipo: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_type?: string
          actor_visitor_id?: string | null
          cart_id?: string
          created_at?: string
          detalle?: Json | null
          id?: never
          product_id?: string | null
          qty_antes?: number | null
          qty_despues?: number | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_cart_events_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "cc_carts"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_cart_items: {
        Row: {
          cart_id: string
          created_at: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          product_id: string
          quantity: number
          updated_at?: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "cc_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_cart_operations: {
        Row: {
          cart_id: string
          created_at: string
          operation_id: string
          payload_hash: string
          resultado: Json
        }
        Insert: {
          cart_id: string
          created_at?: string
          operation_id: string
          payload_hash: string
          resultado: Json
        }
        Update: {
          cart_id?: string
          created_at?: string
          operation_id?: string
          payload_hash?: string
          resultado?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cc_cart_operations_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "cc_carts"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_cartera: {
        Row: {
          asignado_at: string
          asignado_por: string | null
          motivo: string | null
          profile_id: string
          seller_profile_id: string
        }
        Insert: {
          asignado_at?: string
          asignado_por?: string | null
          motivo?: string | null
          profile_id: string
          seller_profile_id: string
        }
        Update: {
          asignado_at?: string
          asignado_por?: string | null
          motivo?: string | null
          profile_id?: string
          seller_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_cartera_asignado_por_fkey"
            columns: ["asignado_por"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_asignado_por_fkey"
            columns: ["asignado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_asignado_por_fkey"
            columns: ["asignado_por"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_cartera_historial: {
        Row: {
          actor_profile_id: string | null
          created_at: string
          id: number
          motivo: string | null
          profile_id: string
          seller_anterior: string | null
          seller_nuevo: string | null
        }
        Insert: {
          actor_profile_id?: string | null
          created_at?: string
          id?: never
          motivo?: string | null
          profile_id: string
          seller_anterior?: string | null
          seller_nuevo?: string | null
        }
        Update: {
          actor_profile_id?: string | null
          created_at?: string
          id?: never
          motivo?: string | null
          profile_id?: string
          seller_anterior?: string | null
          seller_nuevo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cc_cartera_historial_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_seller_anterior_fkey"
            columns: ["seller_anterior"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_seller_anterior_fkey"
            columns: ["seller_anterior"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_seller_anterior_fkey"
            columns: ["seller_anterior"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_seller_nuevo_fkey"
            columns: ["seller_nuevo"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_seller_nuevo_fkey"
            columns: ["seller_nuevo"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_cartera_historial_seller_nuevo_fkey"
            columns: ["seller_nuevo"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_carts: {
        Row: {
          closed_at: string | null
          conversation_id: string | null
          converted_order_id: string | null
          created_at: string
          estado: string
          handoff_at: string | null
          handoff_conversation_id: string | null
          handoff_error: string | null
          handoff_estado: string | null
          id: string
          last_activity_at: string
          merged_into_cart_id: string | null
          oferta_at: string | null
          oferta_estado: string | null
          oferta_respondida_at: string | null
          oferta_siguiente_at: string | null
          profile_id: string | null
          rev: number
          updated_at: string
          visitor_id: string | null
        }
        Insert: {
          closed_at?: string | null
          conversation_id?: string | null
          converted_order_id?: string | null
          created_at?: string
          estado?: string
          handoff_at?: string | null
          handoff_conversation_id?: string | null
          handoff_error?: string | null
          handoff_estado?: string | null
          id?: string
          last_activity_at?: string
          merged_into_cart_id?: string | null
          oferta_at?: string | null
          oferta_estado?: string | null
          oferta_respondida_at?: string | null
          oferta_siguiente_at?: string | null
          profile_id?: string | null
          rev?: number
          updated_at?: string
          visitor_id?: string | null
        }
        Update: {
          closed_at?: string | null
          conversation_id?: string | null
          converted_order_id?: string | null
          created_at?: string
          estado?: string
          handoff_at?: string | null
          handoff_conversation_id?: string | null
          handoff_error?: string | null
          handoff_estado?: string | null
          id?: string
          last_activity_at?: string
          merged_into_cart_id?: string | null
          oferta_at?: string | null
          oferta_estado?: string | null
          oferta_respondida_at?: string | null
          oferta_siguiente_at?: string | null
          profile_id?: string | null
          rev?: number
          updated_at?: string
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cc_carts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "cc_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_carts_converted_order_id_fkey"
            columns: ["converted_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_carts_converted_order_id_fkey"
            columns: ["converted_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "cc_carts_handoff_conversation_id_fkey"
            columns: ["handoff_conversation_id"]
            isOneToOne: false
            referencedRelation: "cc_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_carts_merged_into_cart_id_fkey"
            columns: ["merged_into_cart_id"]
            isOneToOne: false
            referencedRelation: "cc_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_carts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_carts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_carts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_carts_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "cc_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_checkout_events: {
        Row: {
          cart_id: string
          created_at: string
          detalle: Json | null
          id: number
          profile_id: string | null
          review_id: string | null
          tipo: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          detalle?: Json | null
          id?: never
          profile_id?: string | null
          review_id?: string | null
          tipo: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          detalle?: Json | null
          id?: never
          profile_id?: string | null
          review_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_checkout_events_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "cc_carts"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_checkout_operations: {
        Row: {
          cart_id: string
          created_at: string
          operation_id: string
          order_id: string | null
          profile_id: string
          resultado: Json
          review_id: string
          status: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          operation_id: string
          order_id?: string | null
          profile_id: string
          resultado: Json
          review_id: string
          status?: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          operation_id?: string
          order_id?: string | null
          profile_id?: string
          resultado?: Json
          review_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_checkout_operations_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "cc_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_checkout_operations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_checkout_operations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
        ]
      }
      cc_checkout_reviews: {
        Row: {
          cart_id: string
          cart_rev: number
          consumed_at: string | null
          created_at: string
          currency: string
          direccion: Json | null
          expires_at: string
          fingerprint: string
          id: string
          location_id: string | null
          n_items: number
          order_id: string | null
          profile_id: string
          total: number
        }
        Insert: {
          cart_id: string
          cart_rev: number
          consumed_at?: string | null
          created_at?: string
          currency?: string
          direccion?: Json | null
          expires_at: string
          fingerprint: string
          id?: string
          location_id?: string | null
          n_items: number
          order_id?: string | null
          profile_id: string
          total: number
        }
        Update: {
          cart_id?: string
          cart_rev?: number
          consumed_at?: string | null
          created_at?: string
          currency?: string
          direccion?: Json | null
          expires_at?: string
          fingerprint?: string
          id?: string
          location_id?: string | null
          n_items?: number
          order_id?: string | null
          profile_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "cc_checkout_reviews_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "cc_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_checkout_reviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "doctor_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_checkout_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_checkout_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "cc_checkout_reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_checkout_reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_checkout_reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_claim_rules: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          id: string
          motivo: string
          patron: string
          tipo: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          motivo: string
          patron: string
          tipo: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          motivo?: string
          patron?: string
          tipo?: string
        }
        Relationships: []
      }
      cc_company_knowledge: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          audiencia: string
          contenido: string
          created_at: string
          created_by: string | null
          estado: string
          id: string
          importado_de: string | null
          retired_at: string | null
          retired_by: string | null
          retired_reason: string | null
          rev: number
          source_id: string | null
          tema: string
          titulo: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          audiencia?: string
          contenido: string
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          importado_de?: string | null
          retired_at?: string | null
          retired_by?: string | null
          retired_reason?: string | null
          rev?: number
          source_id?: string | null
          tema: string
          titulo: string
          updated_at?: string
          updated_by?: string | null
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          audiencia?: string
          contenido?: string
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          importado_de?: string | null
          retired_at?: string | null
          retired_by?: string | null
          retired_reason?: string | null
          rev?: number
          source_id?: string | null
          tema?: string
          titulo?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cc_company_knowledge_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "cc_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_conversation_events: {
        Row: {
          actor_profile_id: string | null
          actor_type: string | null
          actor_visitor_id: string | null
          conversation_id: string
          created_at: string
          detalle: Json | null
          id: number
          tipo: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_type?: string | null
          actor_visitor_id?: string | null
          conversation_id: string
          created_at?: string
          detalle?: Json | null
          id?: never
          tipo: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_type?: string | null
          actor_visitor_id?: string | null
          conversation_id?: string
          created_at?: string
          detalle?: Json | null
          id?: never
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_conversation_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "cc_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_conversations: {
        Row: {
          asesoria_asignada_at: string | null
          asesoria_iniciada_at: string | null
          asesoria_solicitada_at: string | null
          asesoria_terminada_at: string | null
          closed_at: string | null
          created_at: string
          estado: string
          handoff_cart_id: string | null
          handoff_fuera_horario: boolean | null
          handoff_origen: string | null
          id: string
          last_message_at: string | null
          modo: string
          profile_id: string | null
          ruteo_motivo: string | null
          seller_preferido_id: string | null
          seller_profile_id: string | null
          ultimo_seq: number
          updated_at: string
          visitor_id: string | null
        }
        Insert: {
          asesoria_asignada_at?: string | null
          asesoria_iniciada_at?: string | null
          asesoria_solicitada_at?: string | null
          asesoria_terminada_at?: string | null
          closed_at?: string | null
          created_at?: string
          estado?: string
          handoff_cart_id?: string | null
          handoff_fuera_horario?: boolean | null
          handoff_origen?: string | null
          id?: string
          last_message_at?: string | null
          modo?: string
          profile_id?: string | null
          ruteo_motivo?: string | null
          seller_preferido_id?: string | null
          seller_profile_id?: string | null
          ultimo_seq?: number
          updated_at?: string
          visitor_id?: string | null
        }
        Update: {
          asesoria_asignada_at?: string | null
          asesoria_iniciada_at?: string | null
          asesoria_solicitada_at?: string | null
          asesoria_terminada_at?: string | null
          closed_at?: string | null
          created_at?: string
          estado?: string
          handoff_cart_id?: string | null
          handoff_fuera_horario?: boolean | null
          handoff_origen?: string | null
          id?: string
          last_message_at?: string | null
          modo?: string
          profile_id?: string | null
          ruteo_motivo?: string | null
          seller_preferido_id?: string | null
          seller_profile_id?: string | null
          ultimo_seq?: number
          updated_at?: string
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cc_conversations_handoff_cart_id_fkey"
            columns: ["handoff_cart_id"]
            isOneToOne: false
            referencedRelation: "cc_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_seller_preferido_id_fkey"
            columns: ["seller_preferido_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_seller_preferido_id_fkey"
            columns: ["seller_preferido_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_seller_preferido_id_fkey"
            columns: ["seller_preferido_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_conversations_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "cc_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_horario_config: {
        Row: {
          configurado: boolean
          id: number
          updated_at: string
          updated_by: string | null
          zona: string
        }
        Insert: {
          configurado?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
          zona?: string
        }
        Update: {
          configurado?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
          zona?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_horario_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_horario_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_horario_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_horario_eventos: {
        Row: {
          accion: string
          actor_profile_id: string | null
          created_at: string
          detalle: Json | null
          id: number
        }
        Insert: {
          accion: string
          actor_profile_id?: string | null
          created_at?: string
          detalle?: Json | null
          id?: never
        }
        Update: {
          accion?: string
          actor_profile_id?: string | null
          created_at?: string
          detalle?: Json | null
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "cc_horario_eventos_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_horario_eventos_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_horario_eventos_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_horario_excepciones: {
        Row: {
          abre: string | null
          cierra: string | null
          created_at: string
          created_by: string | null
          fecha: string
          motivo: string | null
          tipo: string
        }
        Insert: {
          abre?: string | null
          cierra?: string | null
          created_at?: string
          created_by?: string | null
          fecha: string
          motivo?: string | null
          tipo: string
        }
        Update: {
          abre?: string | null
          cierra?: string | null
          created_at?: string
          created_by?: string | null
          fecha?: string
          motivo?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_horario_excepciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_horario_excepciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_horario_excepciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_horario_semanal: {
        Row: {
          abierto: boolean
          abre: string | null
          cierra: string | null
          dia: number
        }
        Insert: {
          abierto?: boolean
          abre?: string | null
          cierra?: string | null
          dia: number
        }
        Update: {
          abierto?: boolean
          abre?: string | null
          cierra?: string | null
          dia?: number
        }
        Relationships: []
      }
      cc_knowledge_config: {
        Row: {
          id: string
          t2_habilitado: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          t2_habilitado?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          t2_habilitado?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cc_knowledge_events: {
        Row: {
          accion: string
          actor_profile_id: string | null
          created_at: string
          detalle: Json | null
          entidad: string
          entidad_id: string
          id: number
          version: number | null
        }
        Insert: {
          accion: string
          actor_profile_id?: string | null
          created_at?: string
          detalle?: Json | null
          entidad: string
          entidad_id: string
          id?: never
          version?: number | null
        }
        Update: {
          accion?: string
          actor_profile_id?: string | null
          created_at?: string
          detalle?: Json | null
          entidad?: string
          entidad_id?: string
          id?: never
          version?: number | null
        }
        Relationships: []
      }
      cc_knowledge_sources: {
        Row: {
          captured_at: string
          created_at: string
          created_by: string | null
          documento_url: string | null
          id: string
          notas: string | null
          referencia: string
          tipo: string
          version: string | null
        }
        Insert: {
          captured_at?: string
          created_at?: string
          created_by?: string | null
          documento_url?: string | null
          id?: string
          notas?: string | null
          referencia: string
          tipo: string
          version?: string | null
        }
        Update: {
          captured_at?: string
          created_at?: string
          created_by?: string | null
          documento_url?: string | null
          id?: string
          notas?: string | null
          referencia?: string
          tipo?: string
          version?: string | null
        }
        Relationships: []
      }
      cc_messages: {
        Row: {
          actor_profile_id: string | null
          actor_type: string
          actor_visitor_id: string | null
          client_message_id: string | null
          content: string
          content_hash: string
          content_type: string
          conversation_id: string
          created_at: string
          id: string
          seq: number
        }
        Insert: {
          actor_profile_id?: string | null
          actor_type: string
          actor_visitor_id?: string | null
          client_message_id?: string | null
          content: string
          content_hash: string
          content_type?: string
          conversation_id: string
          created_at?: string
          id?: string
          seq: number
        }
        Update: {
          actor_profile_id?: string | null
          actor_type?: string
          actor_visitor_id?: string | null
          client_message_id?: string | null
          content?: string
          content_hash?: string
          content_type?: string
          conversation_id?: string
          created_at?: string
          id?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "cc_messages_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_messages_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_messages_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_messages_actor_visitor_id_fkey"
            columns: ["actor_visitor_id"]
            isOneToOne: false
            referencedRelation: "cc_visitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "cc_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_participants: {
        Row: {
          actor_type: string
          conversation_id: string
          id: string
          joined_at: string
          last_read_at: string | null
          last_read_seq: number
          left_at: string | null
          profile_id: string | null
          rol: string
          visitor_id: string | null
        }
        Insert: {
          actor_type: string
          conversation_id: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          last_read_seq?: number
          left_at?: string | null
          profile_id?: string | null
          rol: string
          visitor_id?: string | null
        }
        Update: {
          actor_type?: string
          conversation_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          last_read_seq?: number
          left_at?: string | null
          profile_id?: string | null
          rol?: string
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cc_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "cc_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_participants_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "cc_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_product_aliases: {
        Row: {
          activo: boolean
          alias: string
          alias_norm: string
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          tipo: string
        }
        Insert: {
          activo?: boolean
          alias: string
          alias_norm: string
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          tipo?: string
        }
        Update: {
          activo?: boolean
          alias?: string
          alias_norm?: string
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_product_knowledge: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          audiencia: string
          contenido: string
          created_at: string
          created_by: string | null
          datos: Json | null
          estado: string
          id: string
          importado_de: string | null
          nivel: string
          product_id: string
          retired_at: string | null
          retired_by: string | null
          retired_reason: string | null
          rev: number
          seccion: string
          source_id: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          audiencia: string
          contenido: string
          created_at?: string
          created_by?: string | null
          datos?: Json | null
          estado?: string
          id?: string
          importado_de?: string | null
          nivel: string
          product_id: string
          retired_at?: string | null
          retired_by?: string | null
          retired_reason?: string | null
          rev?: number
          seccion: string
          source_id?: string | null
          updated_at?: string
          updated_by?: string | null
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          audiencia?: string
          contenido?: string
          created_at?: string
          created_by?: string | null
          datos?: Json | null
          estado?: string
          id?: string
          importado_de?: string | null
          nivel?: string
          product_id?: string
          retired_at?: string | null
          retired_by?: string | null
          retired_reason?: string | null
          rev?: number
          seccion?: string
          source_id?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cc_product_knowledge_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_knowledge_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_knowledge_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_knowledge_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "cc_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_product_relations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          estado: string
          id: string
          nota: string | null
          product_id: string
          related_id: string
          retired_at: string | null
          retired_by: string | null
          source_id: string | null
          tipo: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          nota?: string | null
          product_id: string
          related_id: string
          retired_at?: string | null
          retired_by?: string | null
          source_id?: string | null
          tipo: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          nota?: string | null
          product_id?: string
          related_id?: string
          retired_at?: string | null
          retired_by?: string | null
          source_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_product_relations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_relations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_relations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_relations_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_relations_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_relations_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_product_relations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "cc_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_referral_codes: {
        Row: {
          activo: boolean
          code: string
          created_at: string
          created_by: string | null
          revoked_at: string | null
          seller_profile_id: string
        }
        Insert: {
          activo?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          revoked_at?: string | null
          seller_profile_id: string
        }
        Update: {
          activo?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          revoked_at?: string | null
          seller_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_referral_codes_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_referral_codes_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_referral_codes_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_visitor_events: {
        Row: {
          actor_profile_id: string | null
          created_at: string
          detalle: Json | null
          id: number
          tipo: string
          visitor_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          created_at?: string
          detalle?: Json | null
          id?: never
          tipo: string
          visitor_id: string
        }
        Update: {
          actor_profile_id?: string | null
          created_at?: string
          detalle?: Json | null
          id?: never
          tipo?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cc_visitor_events_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "cc_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      cc_visitors: {
        Row: {
          adopted_at: string | null
          adopted_profile_id: string | null
          created_at: string
          estado: string
          first_touch: Json | null
          first_touch_at: string | null
          id: string
          last_seen_at: string
          last_touch: Json | null
          last_touch_at: string | null
          pending_at: string | null
          pending_profile_id: string | null
          referral_code: string | null
          seller_profile_id: string | null
          token_hash: string
          visitas: number
        }
        Insert: {
          adopted_at?: string | null
          adopted_profile_id?: string | null
          created_at?: string
          estado?: string
          first_touch?: Json | null
          first_touch_at?: string | null
          id?: string
          last_seen_at?: string
          last_touch?: Json | null
          last_touch_at?: string | null
          pending_at?: string | null
          pending_profile_id?: string | null
          referral_code?: string | null
          seller_profile_id?: string | null
          token_hash: string
          visitas?: number
        }
        Update: {
          adopted_at?: string | null
          adopted_profile_id?: string | null
          created_at?: string
          estado?: string
          first_touch?: Json | null
          first_touch_at?: string | null
          id?: string
          last_seen_at?: string
          last_touch?: Json | null
          last_touch_at?: string | null
          pending_at?: string | null
          pending_profile_id?: string | null
          referral_code?: string | null
          seller_profile_id?: string | null
          token_hash?: string
          visitas?: number
        }
        Relationships: [
          {
            foreignKeyName: "cc_visitors_adopted_profile_id_fkey"
            columns: ["adopted_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_visitors_adopted_profile_id_fkey"
            columns: ["adopted_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_visitors_adopted_profile_id_fkey"
            columns: ["adopted_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_visitors_pending_profile_id_fkey"
            columns: ["pending_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_visitors_pending_profile_id_fkey"
            columns: ["pending_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_visitors_pending_profile_id_fkey"
            columns: ["pending_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_visitors_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_visitors_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cc_visitors_seller_profile_id_fkey"
            columns: ["seller_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      comm_outbox: {
        Row: {
          attempts: number
          canal: string
          claim_token: string | null
          claimed_at: string | null
          created_at: string
          customer_id: string | null
          event_key: string
          first_attempt_at: string | null
          generacion: number
          id: string
          last_error: string | null
          order_id: string | null
          payload: Json
          plantilla: string
          profile_id: string | null
          provider: string | null
          provider_message_id: string | null
          sent_at: string | null
          status: string
          to_address: string | null
          to_name: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          canal?: string
          claim_token?: string | null
          claimed_at?: string | null
          created_at?: string
          customer_id?: string | null
          event_key: string
          first_attempt_at?: string | null
          generacion?: number
          id?: string
          last_error?: string | null
          order_id?: string | null
          payload?: Json
          plantilla: string
          profile_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          to_address?: string | null
          to_name?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          canal?: string
          claim_token?: string | null
          claimed_at?: string | null
          created_at?: string
          customer_id?: string | null
          event_key?: string
          first_attempt_at?: string | null
          generacion?: number
          id?: string
          last_error?: string | null
          order_id?: string | null
          payload?: Json
          plantilla?: string
          profile_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          to_address?: string | null
          to_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comm_outbox_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comm_outbox_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
        ]
      }
      company_bank_accounts: {
        Row: {
          account_number: string | null
          active: boolean
          bank_name: string
          beneficiary_name: string
          clabe: string | null
          created_at: string
          display_order: number
          id: string
          is_default: boolean
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          active?: boolean
          bank_name: string
          beneficiary_name: string
          clabe?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_default?: boolean
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          active?: boolean
          bank_name?: string
          beneficiary_name?: string
          clabe?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_default?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          banco: string | null
          ciudad: string | null
          clabe: string | null
          cp: string | null
          cuenta: string | null
          direccion: string | null
          email: string | null
          estado: string | null
          id: string
          logo_url: string | null
          pais: string | null
          razon_social: string | null
          regimen_fiscal: string | null
          rfc: string | null
          shipping_address: string | null
          shipping_city: string | null
          shipping_country: string | null
          shipping_cp: string | null
          shipping_email: string | null
          shipping_name: string | null
          shipping_phone: string | null
          shipping_state: string | null
          telefono: string | null
          titular: string | null
          updated_at: string
        }
        Insert: {
          banco?: string | null
          ciudad?: string | null
          clabe?: string | null
          cp?: string | null
          cuenta?: string | null
          direccion?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          pais?: string | null
          razon_social?: string | null
          regimen_fiscal?: string | null
          rfc?: string | null
          shipping_address?: string | null
          shipping_city?: string | null
          shipping_country?: string | null
          shipping_cp?: string | null
          shipping_email?: string | null
          shipping_name?: string | null
          shipping_phone?: string | null
          shipping_state?: string | null
          telefono?: string | null
          titular?: string | null
          updated_at?: string
        }
        Update: {
          banco?: string | null
          ciudad?: string | null
          clabe?: string | null
          cp?: string | null
          cuenta?: string | null
          direccion?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          pais?: string | null
          razon_social?: string | null
          regimen_fiscal?: string | null
          rfc?: string | null
          shipping_address?: string | null
          shipping_city?: string | null
          shipping_country?: string | null
          shipping_cp?: string | null
          shipping_email?: string | null
          shipping_name?: string | null
          shipping_phone?: string | null
          shipping_state?: string | null
          telefono?: string | null
          titular?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          area: string | null
          created_at: string | null
          id: string
          kind: string
          last_message_at: string | null
          member_ids: string[]
          title: string | null
        }
        Insert: {
          area?: string | null
          created_at?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          member_ids?: string[]
          title?: string | null
        }
        Update: {
          area?: string | null
          created_at?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          member_ids?: string[]
          title?: string | null
        }
        Relationships: []
      }
      credit_grants: {
        Row: {
          due_date: string
          granted_at: string
          granted_by: string | null
          id: string
          order_id: string
          reason: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          due_date: string
          granted_at?: string
          granted_by?: string | null
          id: string
          order_id: string
          reason: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          due_date?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          order_id?: string
          reason?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_grants_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_grants_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
        ]
      }
      custodies: {
        Row: {
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          event_date: string | null
          event_name: string | null
          event_venue: string | null
          holder_customer_id: string | null
          holder_kind: string
          holder_user_id: string | null
          id: string
          kind: string
          op_id: string | null
          opened_at: string
          opened_by: string | null
          status: string
        }
        Insert: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          event_date?: string | null
          event_name?: string | null
          event_venue?: string | null
          holder_customer_id?: string | null
          holder_kind: string
          holder_user_id?: string | null
          id: string
          kind: string
          op_id?: string | null
          opened_at?: string
          opened_by?: string | null
          status?: string
        }
        Update: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          event_date?: string | null
          event_name?: string | null
          event_venue?: string | null
          holder_customer_id?: string | null
          holder_kind?: string
          holder_user_id?: string | null
          id?: string
          kind?: string
          op_id?: string | null
          opened_at?: string
          opened_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "custodies_holder_customer_id_fkey"
            columns: ["holder_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      custody_lines: {
        Row: {
          actor: string | null
          actor_role: string
          created_at: string
          custody_id: string
          evidence_ref: string | null
          held_delta: number
          id: string
          inventory_op_id: string | null
          kind: string
          lot_id: string
          motivo: string | null
          op_id: string | null
          order_id: string | null
          order_item_id: string | null
          product_id: string
          qty: number
          reversal_of: string | null
          unit_price: number | null
        }
        Insert: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          custody_id: string
          evidence_ref?: string | null
          held_delta: number
          id: string
          inventory_op_id?: string | null
          kind: string
          lot_id: string
          motivo?: string | null
          op_id?: string | null
          order_id?: string | null
          order_item_id?: string | null
          product_id: string
          qty: number
          reversal_of?: string | null
          unit_price?: number | null
        }
        Update: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          custody_id?: string
          evidence_ref?: string | null
          held_delta?: number
          id?: string
          inventory_op_id?: string | null
          kind?: string
          lot_id?: string
          motivo?: string | null
          op_id?: string | null
          order_id?: string | null
          order_item_id?: string | null
          product_id?: string
          qty?: number
          reversal_of?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "custody_lines_custody_id_fkey"
            columns: ["custody_id"]
            isOneToOne: false
            referencedRelation: "custodies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_custody_id_fkey"
            columns: ["custody_id"]
            isOneToOne: false
            referencedRelation: "v_custody_liquidacion"
            referencedColumns: ["custody_id"]
          },
          {
            foreignKeyName: "custody_lines_inventory_op_id_fkey"
            columns: ["inventory_op_id"]
            isOneToOne: false
            referencedRelation: "inventory_operations"
            referencedColumns: ["op_id"]
          },
          {
            foreignKeyName: "custody_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_stock_disponible"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "custody_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "custody_lines_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "custody_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      custody_operations: {
        Row: {
          actor: string | null
          actor_role: string
          created_at: string
          kind: string
          op_id: string
          request: Json
          result: Json | null
        }
        Insert: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          kind: string
          op_id: string
          request: Json
          result?: Json | null
        }
        Update: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          kind?: string
          op_id?: string
          request?: Json
          result?: Json | null
        }
        Relationships: []
      }
      customer_events: {
        Row: {
          actor_profile_id: string | null
          actor_rol: string | null
          created_at: string
          customer_id: string
          detalle: Json | null
          id: number
          tipo: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_rol?: string | null
          created_at?: string
          customer_id: string
          detalle?: Json | null
          id?: never
          tipo: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_rol?: string | null
          created_at?: string
          customer_id?: string
          detalle?: Json | null
          id?: never
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_fiscal_profiles: {
        Row: {
          activo: boolean
          alias: string
          cp: string
          created_at: string
          created_by: string | null
          customer_id: string
          email_facturacion: string
          es_predeterminado: boolean
          id: string
          origen: string
          razon_social: string
          regimen: string
          rfc: string
          updated_at: string
          updated_by: string | null
          uso_cfdi: string
        }
        Insert: {
          activo?: boolean
          alias: string
          cp: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          email_facturacion: string
          es_predeterminado?: boolean
          id?: string
          origen?: string
          razon_social: string
          regimen: string
          rfc: string
          updated_at?: string
          updated_by?: string | null
          uso_cfdi: string
        }
        Update: {
          activo?: boolean
          alias?: string
          cp?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          email_facturacion?: string
          es_predeterminado?: boolean
          id?: string
          origen?: string
          razon_social?: string
          regimen?: string
          rfc?: string
          updated_at?: string
          updated_by?: string | null
          uso_cfdi?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_fiscal_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fiscal_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fiscal_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fiscal_profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fiscal_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fiscal_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fiscal_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notes: {
        Row: {
          autor_profile_id: string | null
          autor_rol: string | null
          created_at: string
          customer_id: string
          id: number
          texto: string
        }
        Insert: {
          autor_profile_id?: string | null
          autor_rol?: string | null
          created_at?: string
          customer_id: string
          id?: never
          texto: string
        }
        Update: {
          autor_profile_id?: string | null
          autor_rol?: string | null
          created_at?: string
          customer_id?: string
          id?: never
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_autor_profile_id_fkey"
            columns: ["autor_profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_autor_profile_id_fkey"
            columns: ["autor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_autor_profile_id_fkey"
            columns: ["autor_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_phones: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          customer_id: string
          es_principal: boolean
          etiqueta: string
          id: string
          numero: string
          numero_norm: string
          origen: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          customer_id: string
          es_principal?: boolean
          etiqueta?: string
          id?: string
          numero: string
          numero_norm: string
          origen?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          customer_id?: string
          es_principal?: boolean
          etiqueta?: string
          id?: string
          numero?: string
          numero_norm?: string
          origen?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_phones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_phones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_phones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_phones_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_phones_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_phones_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_phones_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          active: boolean
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          external_id: string | null
          full_name: string
          id: string
          import_hash: string | null
          meta: Json
          phone: string | null
          profile_id: string | null
          seller_name: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          full_name: string
          id?: string
          import_hash?: string | null
          meta?: Json
          phone?: string | null
          profile_id?: string | null
          seller_name?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          full_name?: string
          id?: string
          import_hash?: string | null
          meta?: Json
          phone?: string | null
          profile_id?: string | null
          seller_name?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      design_calendar: {
        Row: {
          created_at: string | null
          created_by: string | null
          date: string
          id: string
          kind: string
          notes: string | null
          status: string
          title: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date: string
          id?: string
          kind?: string
          notes?: string | null
          status?: string
          title: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date?: string
          id?: string
          kind?: string
          notes?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      doctor_locations: {
        Row: {
          active: boolean
          city: string
          contact_name: string | null
          contact_phone: string | null
          country: string
          created_at: string
          customer_id: string | null
          doctor_id: string | null
          exterior_number: string | null
          id: string
          interior_number: string | null
          is_default: boolean
          line1: string
          municipio: string | null
          name: string
          neighborhood: string | null
          postal_code: string
          reference_notes: string | null
          state: string
          tipo: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city: string
          contact_name?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          customer_id?: string | null
          doctor_id?: string | null
          exterior_number?: string | null
          id?: string
          interior_number?: string | null
          is_default?: boolean
          line1: string
          municipio?: string | null
          name: string
          neighborhood?: string | null
          postal_code: string
          reference_notes?: string | null
          state: string
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string
          contact_name?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          customer_id?: string | null
          doctor_id?: string | null
          exterior_number?: string | null
          id?: string
          interior_number?: string | null
          is_default?: boolean
          line1?: string
          municipio?: string | null
          name?: string
          neighborhood?: string | null
          postal_code?: string
          reference_notes?: string | null
          state?: string
          tipo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_locations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_locations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_locations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_locations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          categoria: string
          concepto: string
          created_at: string | null
          created_by: string | null
          fecha: string
          id: string
          monto: number
        }
        Insert: {
          categoria: string
          concepto: string
          created_at?: string | null
          created_by?: string | null
          fecha: string
          id?: string
          monto: number
        }
        Update: {
          categoria?: string
          concepto?: string
          created_at?: string | null
          created_by?: string | null
          fecha?: string
          id?: string
          monto?: number
        }
        Relationships: []
      }
      fiscal_category_defaults: {
        Row: {
          categoria: string
          clave_prod_serv: string | null
          clave_unidad: string | null
          created_at: string
          definido_at: string | null
          definido_por: string | null
          iva_tasa: number | null
          notas: string | null
          objeto_imp: string | null
          tratamiento_iva: string | null
          updated_at: string
        }
        Insert: {
          categoria: string
          clave_prod_serv?: string | null
          clave_unidad?: string | null
          created_at?: string
          definido_at?: string | null
          definido_por?: string | null
          iva_tasa?: number | null
          notas?: string | null
          objeto_imp?: string | null
          tratamiento_iva?: string | null
          updated_at?: string
        }
        Update: {
          categoria?: string
          clave_prod_serv?: string | null
          clave_unidad?: string | null
          created_at?: string
          definido_at?: string | null
          definido_por?: string | null
          iva_tasa?: number | null
          notas?: string | null
          objeto_imp?: string | null
          tratamiento_iva?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fiscal_document_events: {
        Row: {
          actor: string | null
          actor_role: string
          created_at: string
          event: string
          evidence: Json | null
          fiscal_document_id: string
          from_status: string | null
          id: string
          op_id: string | null
          reason: string | null
          to_status: string
        }
        Insert: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          event: string
          evidence?: Json | null
          fiscal_document_id: string
          from_status?: string | null
          id?: string
          op_id?: string | null
          reason?: string | null
          to_status: string
        }
        Update: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          event?: string
          evidence?: Json | null
          fiscal_document_id?: string
          from_status?: string | null
          id?: string
          op_id?: string | null
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_document_events_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: {
          actor: string | null
          actor_role: string
          attempts: number
          claim_id: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          currency: string | null
          error_code: string | null
          error_message: string | null
          folio: string | null
          forma_pago: string | null
          id: string
          issuer_rfc: string | null
          iva: number | null
          kind: string
          metodo_pago: string | null
          op_id: string | null
          order_id: string
          provider: string
          provider_date_sent: string | null
          provider_env: string | null
          provider_ref: string | null
          provider_stamped_at: string | null
          receiver: Json
          reconcile_note: string | null
          reconciled_at: string | null
          request_fingerprint: string | null
          serie: string | null
          status: string
          subtotal: number | null
          total: number | null
          updated_at: string
          uuid: string | null
        }
        Insert: {
          actor?: string | null
          actor_role?: string
          attempts?: number
          claim_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          currency?: string | null
          error_code?: string | null
          error_message?: string | null
          folio?: string | null
          forma_pago?: string | null
          id: string
          issuer_rfc?: string | null
          iva?: number | null
          kind?: string
          metodo_pago?: string | null
          op_id?: string | null
          order_id: string
          provider?: string
          provider_date_sent?: string | null
          provider_env?: string | null
          provider_ref?: string | null
          provider_stamped_at?: string | null
          receiver: Json
          reconcile_note?: string | null
          reconciled_at?: string | null
          request_fingerprint?: string | null
          serie?: string | null
          status?: string
          subtotal?: number | null
          total?: number | null
          updated_at?: string
          uuid?: string | null
        }
        Update: {
          actor?: string | null
          actor_role?: string
          attempts?: number
          claim_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          currency?: string | null
          error_code?: string | null
          error_message?: string | null
          folio?: string | null
          forma_pago?: string | null
          id?: string
          issuer_rfc?: string | null
          iva?: number | null
          kind?: string
          metodo_pago?: string | null
          op_id?: string | null
          order_id?: string
          provider?: string
          provider_date_sent?: string | null
          provider_env?: string | null
          provider_ref?: string | null
          provider_stamped_at?: string | null
          receiver?: Json
          reconcile_note?: string | null
          reconciled_at?: string | null
          request_fingerprint?: string | null
          serie?: string | null
          status?: string
          subtotal?: number | null
          total?: number | null
          updated_at?: string
          uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
        ]
      }
      fiscal_family_defaults: {
        Row: {
          clave_prod_serv: string | null
          clave_unidad: string | null
          created_at: string
          definido_at: string | null
          definido_por: string | null
          familia: string
          iva_tasa: number | null
          notas: string | null
          objeto_imp: string | null
          tratamiento_iva: string | null
          updated_at: string
        }
        Insert: {
          clave_prod_serv?: string | null
          clave_unidad?: string | null
          created_at?: string
          definido_at?: string | null
          definido_por?: string | null
          familia: string
          iva_tasa?: number | null
          notas?: string | null
          objeto_imp?: string | null
          tratamiento_iva?: string | null
          updated_at?: string
        }
        Update: {
          clave_prod_serv?: string | null
          clave_unidad?: string | null
          created_at?: string
          definido_at?: string | null
          definido_por?: string | null
          familia?: string
          iva_tasa?: number | null
          notas?: string | null
          objeto_imp?: string | null
          tratamiento_iva?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fiscal_folio_domains: {
        Row: {
          issuer_rfc: string
          next_folio: number
          provider: string
          provider_env: string
          updated_at: string
        }
        Insert: {
          issuer_rfc: string
          next_folio?: number
          provider: string
          provider_env: string
          updated_at?: string
        }
        Update: {
          issuer_rfc?: string
          next_folio?: number
          provider?: string
          provider_env?: string
          updated_at?: string
        }
        Relationships: []
      }
      fiscal_operations: {
        Row: {
          actor: string | null
          actor_role: string
          created_at: string
          kind: string
          op_id: string
          request: Json
          result: Json | null
        }
        Insert: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          kind: string
          op_id: string
          request: Json
          result?: Json | null
        }
        Update: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          kind?: string
          op_id?: string
          request?: Json
          result?: Json | null
        }
        Relationships: []
      }
      fiscal_price_evidence: {
        Row: {
          actor: string | null
          actor_role: string
          clasificacion: string
          created_at: string
          familia_publicada: string | null
          id: string
          import_op_id: string
          mapeo_estado: string
          mapeo_metodo: string | null
          mapeo_motivo: string | null
          precio_historico: number | null
          precio_publicado: number | null
          procedencia: string | null
          product_id: string | null
          source_nombre: string
          source_ref: string
          source_referencia: string | null
        }
        Insert: {
          actor?: string | null
          actor_role?: string
          clasificacion: string
          created_at?: string
          familia_publicada?: string | null
          id?: string
          import_op_id: string
          mapeo_estado: string
          mapeo_metodo?: string | null
          mapeo_motivo?: string | null
          precio_historico?: number | null
          precio_publicado?: number | null
          procedencia?: string | null
          product_id?: string | null
          source_nombre: string
          source_ref: string
          source_referencia?: string | null
        }
        Update: {
          actor?: string | null
          actor_role?: string
          clasificacion?: string
          created_at?: string
          familia_publicada?: string | null
          id?: string
          import_op_id?: string
          mapeo_estado?: string
          mapeo_metodo?: string | null
          mapeo_motivo?: string | null
          precio_historico?: number | null
          precio_publicado?: number | null
          procedencia?: string | null
          product_id?: string | null
          source_nombre?: string
          source_ref?: string
          source_referencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_price_evidence_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_price_evidence_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_price_evidence_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_reconciliations: {
        Row: {
          actor: string | null
          actor_role: string
          candidates: number
          created_at: string
          detail: string | null
          fiscal_document_id: string
          id: string
          op_id: string | null
          outcome: string
          probe_kind: string
          provider_env: string | null
          sat_status: string | null
          uuid_found: string | null
        }
        Insert: {
          actor?: string | null
          actor_role?: string
          candidates?: number
          created_at?: string
          detail?: string | null
          fiscal_document_id: string
          id?: string
          op_id?: string | null
          outcome: string
          probe_kind: string
          provider_env?: string | null
          sat_status?: string | null
          uuid_found?: string | null
        }
        Update: {
          actor?: string | null
          actor_role?: string
          candidates?: number
          created_at?: string
          detail?: string | null
          fiscal_document_id?: string
          id?: string
          op_id?: string | null
          outcome?: string
          probe_kind?: string
          provider_env?: string | null
          sat_status?: string | null
          uuid_found?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_reconciliations_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_series: {
        Row: {
          activa: boolean
          created_at: string
          descripcion: string | null
          provider: string
          serie: string
        }
        Insert: {
          activa?: boolean
          created_at?: string
          descripcion?: string | null
          provider?: string
          serie: string
        }
        Update: {
          activa?: boolean
          created_at?: string
          descripcion?: string | null
          provider?: string
          serie?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          change: number
          created_at: string | null
          created_by: string | null
          id: string
          lot_id: string
          op_id: string
          order_id: string | null
          order_item_id: string | null
          reason: string | null
          receipt_id: string | null
          reference: string | null
          return_line_id: string | null
          unit_cost: number | null
        }
        Insert: {
          change: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          lot_id: string
          op_id: string
          order_id?: string | null
          order_item_id?: string | null
          reason?: string | null
          receipt_id?: string | null
          reference?: string | null
          return_line_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          change?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          lot_id?: string
          op_id?: string
          order_id?: string | null
          order_item_id?: string | null
          reason?: string | null
          receipt_id?: string | null
          reference?: string | null
          return_line_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_stock_disponible"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "inventory_movements_op_id_fkey"
            columns: ["op_id"]
            isOneToOne: false
            referencedRelation: "inventory_operations"
            referencedColumns: ["op_id"]
          },
          {
            foreignKeyName: "inventory_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "inventory_movements_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_return_line_id_fkey"
            columns: ["return_line_id"]
            isOneToOne: false
            referencedRelation: "stock_return_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_operations: {
        Row: {
          actor: string | null
          actor_role: string
          created_at: string
          kind: string
          op_id: string
          request_hash: string
          result: Json
        }
        Insert: {
          actor?: string | null
          actor_role: string
          created_at?: string
          kind: string
          op_id: string
          request_hash: string
          result: Json
        }
        Update: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          kind?: string
          op_id?: string
          request_hash?: string
          result?: Json
        }
        Relationships: []
      }
      landing_content: {
        Row: {
          content: Json
          id: string
          updated_at: string | null
        }
        Insert: {
          content: Json
          id?: string
          updated_at?: string | null
        }
        Update: {
          content?: Json
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      lots: {
        Row: {
          caducidad_avisada_at: string | null
          expiry_date: string
          id: string
          location: string | null
          lot_code: string
          lot_code_norm: string | null
          manufacture_date: string | null
          metadata: Json | null
          product_id: string
          quantity: number
          unit_cost: number | null
        }
        Insert: {
          caducidad_avisada_at?: string | null
          expiry_date: string
          id?: string
          location?: string | null
          lot_code: string
          lot_code_norm?: string | null
          manufacture_date?: string | null
          metadata?: Json | null
          product_id: string
          quantity?: number
          unit_cost?: number | null
        }
        Update: {
          caducidad_avisada_at?: string | null
          expiry_date?: string
          id?: string
          location?: string | null
          lot_code?: string
          lot_code_norm?: string | null
          manufacture_date?: string | null
          metadata?: Json | null
          product_id?: string
          quantity?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string | null
          id: string
          sender_id: string | null
          sender_name: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string | null
          id?: string
          sender_id?: string | null
          sender_name?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          sender_id?: string | null
          sender_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      money_operations: {
        Row: {
          actor: string | null
          actor_role: string
          created_at: string
          kind: string
          op_id: string
          request_hash: string
          result: Json
        }
        Insert: {
          actor?: string | null
          actor_role: string
          created_at?: string
          kind: string
          op_id: string
          request_hash: string
          result: Json
        }
        Update: {
          actor?: string | null
          actor_role?: string
          created_at?: string
          kind?: string
          op_id?: string
          request_hash?: string
          result?: Json
        }
        Relationships: []
      }
      notification_reads: {
        Row: {
          notification_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          notification_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          notification_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string | null
          created_by: string | null
          id: string
          roles: string[] | null
          screen: string | null
          user_ids: string[] | null
        }
        Insert: {
          body: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          roles?: string[] | null
          screen?: string | null
          user_ids?: string[] | null
        }
        Update: {
          body?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          roles?: string[] | null
          screen?: string | null
          user_ids?: string[] | null
        }
        Relationships: []
      }
      order_cancellations: {
        Row: {
          actor_role: string
          cancelled_by: string | null
          created_at: string
          money_signal: string | null
          op_id: string
          order_id: string
          prior_status: string
          reason: string | null
          refund_review: string
          return_id: string | null
        }
        Insert: {
          actor_role: string
          cancelled_by?: string | null
          created_at?: string
          money_signal?: string | null
          op_id: string
          order_id: string
          prior_status: string
          reason?: string | null
          refund_review: string
          return_id?: string | null
        }
        Update: {
          actor_role?: string
          cancelled_by?: string | null
          created_at?: string
          money_signal?: string | null
          op_id?: string
          order_id?: string
          prior_status?: string
          reason?: string | null
          refund_review?: string
          return_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_cancellations_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "stock_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          id: string
          lot_id: string | null
          order_id: string | null
          product_id: string | null
          qty: number
          unit_price: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          lot_id?: string | null
          order_id?: string | null
          product_id?: string | null
          qty: number
          unit_price?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          lot_id?: string | null
          order_id?: string | null
          product_id?: string | null
          qty?: number
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_stock_disponible"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cobranza_avisada_at: string | null
          created_at: string | null
          currency: string | null
          customer_id: string | null
          doctor_id: string | null
          external_ref: string | null
          id: string
          invoice_meta: Json | null
          invoice_requested: boolean | null
          payment_method: string | null
          payment_ref: string | null
          payment_status: string | null
          shipping_meta: Json | null
          status: string | null
          stripe_payment_id: string | null
          total: number | null
        }
        Insert: {
          cobranza_avisada_at?: string | null
          created_at?: string | null
          currency?: string | null
          customer_id?: string | null
          doctor_id?: string | null
          external_ref?: string | null
          id?: string
          invoice_meta?: Json | null
          invoice_requested?: boolean | null
          payment_method?: string | null
          payment_ref?: string | null
          payment_status?: string | null
          shipping_meta?: Json | null
          status?: string | null
          stripe_payment_id?: string | null
          total?: number | null
        }
        Update: {
          cobranza_avisada_at?: string | null
          created_at?: string | null
          currency?: string | null
          customer_id?: string | null
          doctor_id?: string | null
          external_ref?: string | null
          id?: string
          invoice_meta?: Json | null
          invoice_requested?: boolean | null
          payment_method?: string | null
          payment_ref?: string | null
          payment_status?: string | null
          shipping_meta?: Json | null
          status?: string | null
          stripe_payment_id?: string | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_claims: {
        Row: {
          amount_declared: number
          bank_account_id: string | null
          created_at: string
          declared_at: string
          declared_by: string | null
          entry_id: string | null
          id: string
          method: string
          order_id: string
          proof_path: string | null
          reference: string | null
          reject_reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          amount_declared: number
          bank_account_id?: string | null
          created_at?: string
          declared_at?: string
          declared_by?: string | null
          entry_id?: string | null
          id: string
          method: string
          order_id: string
          proof_path?: string | null
          reference?: string | null
          reject_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          amount_declared?: number
          bank_account_id?: string | null
          created_at?: string
          declared_at?: string
          declared_by?: string | null
          entry_id?: string | null
          id?: string
          method?: string
          order_id?: string
          proof_path?: string | null
          reference?: string | null
          reject_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_claims_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "company_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_claims_entry_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "payment_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_claims_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_claims_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
        ]
      }
      payment_entries: {
        Row: {
          actor_role: string
          amount: number
          bank_account_id: string | null
          claim_id: string | null
          created_at: string
          currency: string
          direction: string
          evidence_ref: string | null
          external_ref: string | null
          id: string
          method: string
          notes: string | null
          order_id: string
          recorded_by: string | null
          refund_id: string | null
          reversal_of: string | null
          value_date: string
        }
        Insert: {
          actor_role: string
          amount: number
          bank_account_id?: string | null
          claim_id?: string | null
          created_at?: string
          currency?: string
          direction: string
          evidence_ref?: string | null
          external_ref?: string | null
          id: string
          method: string
          notes?: string | null
          order_id: string
          recorded_by?: string | null
          refund_id?: string | null
          reversal_of?: string | null
          value_date?: string
        }
        Update: {
          actor_role?: string
          amount?: number
          bank_account_id?: string | null
          claim_id?: string | null
          created_at?: string
          currency?: string
          direction?: string
          evidence_ref?: string | null
          external_ref?: string | null
          id?: string
          method?: string
          notes?: string | null
          order_id?: string
          recorded_by?: string | null
          refund_id?: string | null
          reversal_of?: string | null
          value_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_entries_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "company_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_entries_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "payment_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "payment_entries_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "payment_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean
          name: string
          sort: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean
          name: string
          sort?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean
          name?: string
          sort?: number
        }
        Relationships: []
      }
      product_costs: {
        Row: {
          metadata: Json | null
          notes: string | null
          product_id: string
          supplier: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          metadata?: Json | null
          notes?: string | null
          product_id: string
          supplier?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          metadata?: Json | null
          notes?: string | null
          product_id?: string
          supplier?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fiscal: {
        Row: {
          clave_prod_serv: string | null
          clave_unidad: string | null
          created_at: string
          descripcion_fiscal: string | null
          evidencia_historica: string | null
          evidencia_procedencia: string | null
          fuente: string | null
          iva_tasa: number | null
          notas: string | null
          objeto_imp: string | null
          precio_historico: number | null
          precio_publicado: number | null
          product_id: string
          tratamiento_iva: string | null
          updated_at: string
          validado: boolean
          validado_at: string | null
          validado_por: string | null
        }
        Insert: {
          clave_prod_serv?: string | null
          clave_unidad?: string | null
          created_at?: string
          descripcion_fiscal?: string | null
          evidencia_historica?: string | null
          evidencia_procedencia?: string | null
          fuente?: string | null
          iva_tasa?: number | null
          notas?: string | null
          objeto_imp?: string | null
          precio_historico?: number | null
          precio_publicado?: number | null
          product_id: string
          tratamiento_iva?: string | null
          updated_at?: string
          validado?: boolean
          validado_at?: string | null
          validado_por?: string | null
        }
        Update: {
          clave_prod_serv?: string | null
          clave_unidad?: string | null
          created_at?: string
          descripcion_fiscal?: string | null
          evidencia_historica?: string | null
          evidencia_procedencia?: string | null
          fuente?: string | null
          iva_tasa?: number | null
          notas?: string | null
          objeto_imp?: string | null
          precio_historico?: number | null
          precio_publicado?: number | null
          product_id?: string
          tratamiento_iva?: string | null
          updated_at?: string
          validado?: boolean
          validado_at?: string | null
          validado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fiscal_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fiscal_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fiscal_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fiscal_events: {
        Row: {
          actor: string | null
          actor_role: string
          antes: Json | null
          campo: string | null
          created_at: string
          despues: Json | null
          evento: string
          id: string
          motivo: string | null
          op_id: string | null
          product_id: string
        }
        Insert: {
          actor?: string | null
          actor_role?: string
          antes?: Json | null
          campo?: string | null
          created_at?: string
          despues?: Json | null
          evento: string
          id?: string
          motivo?: string | null
          op_id?: string | null
          product_id: string
        }
        Update: {
          actor?: string | null
          actor_role?: string
          antes?: Json | null
          campo?: string | null
          created_at?: string
          despues?: Json | null
          evento?: string
          id?: string
          motivo?: string | null
          op_id?: string | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_fiscal_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fiscal_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fiscal_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      product_prices: {
        Row: {
          list_id: string
          price: number
          product_id: string
          updated_at: string | null
        }
        Insert: {
          list_id: string
          price: number
          product_id: string
          updated_at?: string | null
        }
        Update: {
          list_id?: string
          price?: number
          product_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_prices_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      product_volume_prices: {
        Row: {
          active: boolean
          created_at: string
          discount_percent: number | null
          id: string
          min_quantity: number
          price: number
          product_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          discount_percent?: number | null
          id?: string
          min_quantity: number
          price: number
          product_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          discount_percent?: number | null
          id?: string
          min_quantity?: number
          price?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_volume_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_volume_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_volume_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          brochure_url: string | null
          category: string | null
          description: string | null
          family: string | null
          id: string
          image_url: string | null
          line: string | null
          metadata: Json | null
          name: string
          odoo_identity_key: string | null
          odoo_reference: string | null
          parent_product_id: string | null
          price: number | null
          sellable: boolean
          show_landing: boolean
          show_portal: boolean
          sku: string
          unit: string | null
        }
        Insert: {
          active?: boolean
          brochure_url?: string | null
          category?: string | null
          description?: string | null
          family?: string | null
          id?: string
          image_url?: string | null
          line?: string | null
          metadata?: Json | null
          name: string
          odoo_identity_key?: string | null
          odoo_reference?: string | null
          parent_product_id?: string | null
          price?: number | null
          sellable?: boolean
          show_landing?: boolean
          show_portal?: boolean
          sku: string
          unit?: string | null
        }
        Update: {
          active?: boolean
          brochure_url?: string | null
          category?: string | null
          description?: string | null
          family?: string | null
          id?: string
          image_url?: string | null
          line?: string | null
          metadata?: Json | null
          name?: string
          odoo_identity_key?: string | null
          odoo_reference?: string | null
          parent_product_id?: string | null
          price?: number | null
          sellable?: boolean
          show_landing?: boolean
          show_portal?: boolean
          sku?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          email: string | null
          full_name: string | null
          id: string
          meta: Json | null
          organization: string | null
          price_list_id: string | null
          role_id: string | null
          verified: boolean | null
        }
        Insert: {
          active?: boolean
          email?: string | null
          full_name?: string | null
          id: string
          meta?: Json | null
          organization?: string | null
          price_list_id?: string | null
          role_id?: string | null
          verified?: boolean | null
        }
        Update: {
          active?: boolean
          email?: string | null
          full_name?: string | null
          id?: string
          meta?: Json | null
          organization?: string | null
          price_list_id?: string | null
          role_id?: string | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          assigned_to: string | null
          cedula: string | null
          created_at: string | null
          customer_id: string | null
          email: string | null
          id: string
          meta: Json | null
          name: string | null
          phone: string | null
          source: string | null
          status: string | null
          visitor_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          cedula?: string | null
          created_at?: string | null
          customer_id?: string | null
          email?: string | null
          id?: string
          meta?: Json | null
          name?: string | null
          phone?: string | null
          source?: string | null
          status?: string | null
          visitor_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          cedula?: string | null
          created_at?: string | null
          customer_id?: string | null
          email?: string | null
          id?: string
          meta?: Json | null
          name?: string | null
          phone?: string | null
          source?: string | null
          status?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospects_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "cc_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipts: {
        Row: {
          authorized_by: string | null
          created_at: string
          evidence_ref: string | null
          id: string
          kind: string
          lot_id: string
          product_id: string
          qty: number
          reason: string | null
          received_by: string | null
          replenishment_id: string | null
          unit_cost: number | null
        }
        Insert: {
          authorized_by?: string | null
          created_at?: string
          evidence_ref?: string | null
          id: string
          kind: string
          lot_id: string
          product_id: string
          qty: number
          reason?: string | null
          received_by?: string | null
          replenishment_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          authorized_by?: string | null
          created_at?: string
          evidence_ref?: string | null
          id?: string
          kind?: string
          lot_id?: string
          product_id?: string
          qty?: number
          reason?: string | null
          received_by?: string | null
          replenishment_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_stock_disponible"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "purchase_receipts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_replenishment_id_fkey"
            columns: ["replenishment_id"]
            isOneToOne: false
            referencedRelation: "replenishments"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          count: number
          scope: string
          subject: string
          updated_at: string
          window_start: string
        }
        Insert: {
          count?: number
          scope: string
          subject: string
          updated_at?: string
          window_start: string
        }
        Update: {
          count?: number
          scope?: string
          subject?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          items: Json | null
          metodo: string | null
          monto: number
          motivo: string
          op_id: string | null
          order_id: string
          return_id: string | null
          tipo: string
          usuario: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          items?: Json | null
          metodo?: string | null
          monto: number
          motivo: string
          op_id?: string | null
          order_id: string
          return_id?: string | null
          tipo: string
          usuario?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          items?: Json | null
          metodo?: string | null
          monto?: number
          motivo?: string
          op_id?: string | null
          order_id?: string
          return_id?: string | null
          tipo?: string
          usuario?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "refunds_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "stock_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      replenishments: {
        Row: {
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string | null
          created_by: string | null
          id: string
          kind: string
          paid: boolean
          product_id: string | null
          product_name: string | null
          qty: number
          received_qty: number
          status: string
          supplier: string | null
          unit_cost: number
        }
        Insert: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          kind: string
          paid?: boolean
          product_id?: string | null
          product_name?: string | null
          qty: number
          received_qty?: number
          status?: string
          supplier?: string | null
          unit_cost: number
        }
        Update: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          kind?: string
          paid?: boolean
          product_id?: string | null
          product_name?: string | null
          qty?: number
          received_qty?: number
          status?: string
          supplier?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "replenishments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replenishments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replenishments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_requests: {
        Row: {
          asset_url: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          origin: string
          requested_by: string | null
          requested_by_id: string | null
          status: string
          title: string
        }
        Insert: {
          asset_url?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          origin?: string
          requested_by?: string | null
          requested_by_id?: string | null
          status?: string
          title: string
        }
        Update: {
          asset_url?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          origin?: string
          requested_by?: string | null
          requested_by_id?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      roles: {
        Row: {
          description: string | null
          id: string
        }
        Insert: {
          description?: string | null
          id: string
        }
        Update: {
          description?: string | null
          id?: string
        }
        Relationships: []
      }
      sales_targets: {
        Row: {
          commission_rate: number
          seller: string
          target: number
          updated_at: string
        }
        Insert: {
          commission_rate?: number
          seller: string
          target?: number
          updated_at?: string
        }
        Update: {
          commission_rate?: number
          seller?: string
          target?: number
          updated_at?: string
        }
        Relationships: []
      }
      shipments: {
        Row: {
          carrier: string | null
          created_at: string | null
          currency: string | null
          customer_charge: number | null
          delivered_at: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          driver_id: string | null
          estimated_delivery_at: string | null
          id: string
          incident: Json | null
          label_path: string | null
          label_url: string | null
          load_confirmed_at: string | null
          order_id: string | null
          package: Json | null
          pickup_confirmation: string | null
          proof_image_url: string | null
          provider: string | null
          provider_cost: number | null
          provider_meta: Json | null
          quote_ref: string | null
          received_by: string | null
          service_code: string | null
          ship_from: Json | null
          ship_to: Json | null
          status: string | null
          tracking_number: string | null
        }
        Insert: {
          carrier?: string | null
          created_at?: string | null
          currency?: string | null
          customer_charge?: number | null
          delivered_at?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          driver_id?: string | null
          estimated_delivery_at?: string | null
          id?: string
          incident?: Json | null
          label_path?: string | null
          label_url?: string | null
          load_confirmed_at?: string | null
          order_id?: string | null
          package?: Json | null
          pickup_confirmation?: string | null
          proof_image_url?: string | null
          provider?: string | null
          provider_cost?: number | null
          provider_meta?: Json | null
          quote_ref?: string | null
          received_by?: string | null
          service_code?: string | null
          ship_from?: Json | null
          ship_to?: Json | null
          status?: string | null
          tracking_number?: string | null
        }
        Update: {
          carrier?: string | null
          created_at?: string | null
          currency?: string | null
          customer_charge?: number | null
          delivered_at?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          driver_id?: string | null
          estimated_delivery_at?: string | null
          id?: string
          incident?: Json | null
          label_path?: string | null
          label_url?: string | null
          load_confirmed_at?: string | null
          order_id?: string | null
          package?: Json | null
          pickup_confirmation?: string | null
          proof_image_url?: string | null
          provider?: string | null
          provider_cost?: number | null
          provider_meta?: Json | null
          quote_ref?: string | null
          received_by?: string | null
          service_code?: string | null
          ship_from?: Json | null
          ship_to?: Json | null
          status?: string | null
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "doctor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "staff_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
        ]
      }
      shipping_attempts: {
        Row: {
          created_at: string
          currency: string | null
          error: string | null
          external_reference: string | null
          id: string
          idempotency_key: string
          order_id: string
          provider: string
          provider_cost: number | null
          quote_ref: string | null
          request_fingerprint: string | null
          service_code: string | null
          status: string
          tracking_number: string | null
          updated_at: string
          void_evidence: string | null
          void_reference: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          created_at?: string
          currency?: string | null
          error?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key: string
          order_id: string
          provider?: string
          provider_cost?: number | null
          quote_ref?: string | null
          request_fingerprint?: string | null
          service_code?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
          void_evidence?: string | null
          void_reference?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          created_at?: string
          currency?: string | null
          error?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string
          order_id?: string
          provider?: string
          provider_cost?: number | null
          quote_ref?: string | null
          request_fingerprint?: string | null
          service_code?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
          void_evidence?: string | null
          void_reference?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
        ]
      }
      sistema_latidos: {
        Row: {
          actualizado: string
          detalle: string | null
          duracion_ms: number | null
          fuente: string
          procesados: number | null
          ultimo_error: string | null
          ultimo_ok: string | null
        }
        Insert: {
          actualizado?: string
          detalle?: string | null
          duracion_ms?: number | null
          fuente: string
          procesados?: number | null
          ultimo_error?: string | null
          ultimo_ok?: string | null
        }
        Update: {
          actualizado?: string
          detalle?: string | null
          duracion_ms?: number | null
          fuente?: string
          procesados?: number | null
          ultimo_error?: string | null
          ultimo_ok?: string | null
        }
        Relationships: []
      }
      stock_return_lines: {
        Row: {
          created_at: string
          disposed_at: string | null
          disposed_by: string | null
          disposition: string | null
          disposition_op_id: string | null
          id: string
          inspected_at: string | null
          inspected_by: string | null
          inspection: string | null
          lot_id: string
          notes: string | null
          order_id: string
          order_item_id: string | null
          product_id: string
          qty: number
          return_id: string
        }
        Insert: {
          created_at?: string
          disposed_at?: string | null
          disposed_by?: string | null
          disposition?: string | null
          disposition_op_id?: string | null
          id?: string
          inspected_at?: string | null
          inspected_by?: string | null
          inspection?: string | null
          lot_id: string
          notes?: string | null
          order_id: string
          order_item_id?: string | null
          product_id: string
          qty: number
          return_id: string
        }
        Update: {
          created_at?: string
          disposed_at?: string | null
          disposed_by?: string | null
          disposition?: string | null
          disposition_op_id?: string | null
          id?: string
          inspected_at?: string | null
          inspected_by?: string | null
          inspection?: string | null
          lot_id?: string
          notes?: string | null
          order_id?: string
          order_item_id?: string | null
          product_id?: string
          qty?: number
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_return_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_stock_disponible"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "stock_return_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "stock_return_lines_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "stock_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_returns: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          order_id: string
          origin: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id: string
          notes?: string | null
          order_id: string
          origin: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          origin?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_money"
            referencedColumns: ["order_id"]
          },
        ]
      }
    }
    Views: {
      catalog_public: {
        Row: {
          brochure_url: string | null
          category: string | null
          description: string | null
          id: string | null
          image_url: string | null
          line: string | null
          metadata: Json | null
          name: string | null
        }
        Insert: {
          brochure_url?: string | null
          category?: string | null
          description?: string | null
          id?: string | null
          image_url?: string | null
          line?: string | null
          metadata?: Json | null
          name?: string | null
        }
        Update: {
          brochure_url?: string | null
          category?: string | null
          description?: string | null
          id?: string | null
          image_url?: string | null
          line?: string | null
          metadata?: Json | null
          name?: string | null
        }
        Relationships: []
      }
      doctor_directory: {
        Row: {
          id: string | null
          meta: Json | null
          name: string | null
          organization: string | null
          verified: boolean | null
        }
        Insert: {
          id?: string | null
          meta?: never
          name?: never
          organization?: string | null
          verified?: boolean | null
        }
        Update: {
          id?: string | null
          meta?: never
          name?: never
          organization?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
      product_stock: {
        Row: {
          available: number | null
          product_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      products_safe: {
        Row: {
          active: boolean | null
          category: string | null
          description: string | null
          family: string | null
          id: string | null
          image_url: string | null
          line: string | null
          name: string | null
          parent_product_id: string | null
          price: number | null
          sellable: boolean | null
          show_landing: boolean | null
          show_portal: boolean | null
          sku: string | null
          unit: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          description?: string | null
          family?: string | null
          id?: string | null
          image_url?: string | null
          line?: string | null
          name?: string | null
          parent_product_id?: string | null
          price?: number | null
          sellable?: boolean | null
          show_landing?: boolean | null
          show_portal?: boolean | null
          sku?: string | null
          unit?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          description?: string | null
          family?: string | null
          id?: string | null
          image_url?: string | null
          line?: string | null
          name?: string | null
          parent_product_id?: string | null
          price?: number | null
          sellable?: boolean | null
          show_landing?: boolean | null
          show_portal?: boolean | null
          sku?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_directory: {
        Row: {
          avatar_url: string | null
          id: string | null
          name: string | null
          role_id: string | null
        }
        Insert: {
          avatar_url?: never
          id?: string | null
          name?: never
          role_id?: string | null
        }
        Update: {
          avatar_url?: never
          id?: string | null
          name?: never
          role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_custody_liquidacion: {
        Row: {
          cobrado: number | null
          custody_id: string | null
          importe_vendido: number | null
          kind: string | null
          saldo: number | null
          status: string | null
          unidades_devueltas: number | null
          unidades_en_poder: number | null
          unidades_entregadas: number | null
          unidades_perdidas: number | null
          unidades_vendidas: number | null
        }
        Relationships: []
      }
      v_custody_stock: {
        Row: {
          custody_id: string | null
          devuelto: number | null
          en_poder: number | null
          entregado: number | null
          lot_id: string | null
          perdido: number | null
          product_id: string | null
          vendido: number | null
        }
        Relationships: [
          {
            foreignKeyName: "custody_lines_custody_id_fkey"
            columns: ["custody_id"]
            isOneToOne: false
            referencedRelation: "custodies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_custody_id_fkey"
            columns: ["custody_id"]
            isOneToOne: false
            referencedRelation: "v_custody_liquidacion"
            referencedColumns: ["custody_id"]
          },
          {
            foreignKeyName: "custody_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_stock_disponible"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "custody_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      v_order_money: {
        Row: {
          cobrado: number | null
          cobrado_neto: number | null
          credito_autorizado: boolean | null
          due_date: string | null
          estado_pago: string | null
          external_ref: string | null
          liberado: boolean | null
          order_id: string | null
          order_status: string | null
          payment_status: string | null
          reembolsado: number | null
          reembolso_pendiente: number | null
          saldo: number | null
          sobrepago: boolean | null
          total: number | null
          vencido: boolean | null
        }
        Relationships: []
      }
      v_stock_disponible: {
        Row: {
          caducado: boolean | null
          disponible: number | null
          en_custodia: number | null
          expiry_date: string | null
          location: string | null
          lot_code: string | null
          lot_id: string | null
          product_id: string | null
          propio: number | null
        }
        Insert: {
          caducado?: never
          disponible?: never
          en_custodia?: never
          expiry_date?: string | null
          location?: string | null
          lot_code?: string | null
          lot_id?: string | null
          product_id?: string | null
          propio?: number | null
        }
        Update: {
          caducado?: never
          disponible?: never
          en_custodia?: never
          expiry_date?: string | null
          location?: string | null
          lot_code?: string | null
          lot_id?: string | null
          product_id?: string | null
          propio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _c360_actor: { Args: { p_customer: string }; Returns: string }
      _c360_cliente: { Args: { p_customer: string }; Returns: string }
      _c360_cliente_de_ubicacion: {
        Args: { p_ubicacion: string }
        Returns: string
      }
      _c360_espejo_fiscal: { Args: { p_customer: string }; Returns: undefined }
      _c360_espejo_tel: { Args: { p_customer: string }; Returns: undefined }
      _c360_evento: {
        Args: {
          p_actor: string
          p_customer: string
          p_detalle: Json
          p_tipo: string
        }
        Returns: undefined
      }
      _c360_exige: {
        Args: { p_customer: string; p_permitidos: string[] }
        Returns: string
      }
      _c360_fiscal_predeterminar: {
        Args: { p_customer: string; p_perfil: string }
        Returns: undefined
      }
      _c360_tel_norm: { Args: { p: string }; Returns: string }
      _c360_tel_valido: { Args: { p: string }; Returns: boolean }
      _c360_ubic_predeterminar: {
        Args: { p_customer: string; p_ubicacion: string }
        Returns: undefined
      }
      _c360_ubic_validar: { Args: { d: Json }; Returns: Json }
      _cc_adoptar_carritos: {
        Args: { p_profile: string; p_visitor: string }
        Returns: number
      }
      _cc_adoptar_conversaciones: {
        Args: { p_profile: string; p_visitor: string }
        Returns: number
      }
      _cc_atribuible: { Args: { p: Json }; Returns: boolean }
      _cc_attr_limpia: { Args: { p: Json }; Returns: Json }
      _cc_audiencia: { Args: { p_solicitada?: string }; Returns: string }
      _cc_audiencia_minima: { Args: { p_nivel: string }; Returns: string }
      _cc_audiencia_rango: { Args: { p_aud: string }; Returns: number }
      _cc_autoridad: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_visitor: string
        }
        Returns: string
      }
      _cc_cambiar_modo: {
        Args: {
          p_a: string
          p_actor_type: string
          p_conv: string
          p_detalle?: Json
          p_profile: string
          p_tipo_evento: string
          p_visitor: string
        }
        Returns: undefined
      }
      _cc_cart_activo: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_visitor: string
        }
        Returns: string
      }
      _cc_cart_actor: {
        Args: {
          p_actor_type: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Record<string, unknown>
      }
      _cc_cart_autoridad: {
        Args: {
          p_actor_type: string
          p_cart: string
          p_profile: string
          p_visitor: string
        }
        Returns: string
      }
      _cc_cart_evento: {
        Args: {
          p_actor_type: string
          p_antes?: number
          p_cart: string
          p_despues?: number
          p_detalle?: Json
          p_product?: string
          p_profile: string
          p_tipo: string
          p_visitor: string
        }
        Returns: undefined
      }
      _cc_cart_mutar: {
        Args: {
          p_accion: string
          p_actor_type: string
          p_cart: string
          p_op: string
          p_product: string
          p_profile: string
          p_qty: number
          p_visitor_hash: string
        }
        Returns: Json
      }
      _cc_cart_operacion: {
        Args: { p_cart: string; p_op: string; p_payload: Json }
        Returns: Json
      }
      _cc_cart_registrar_op: {
        Args: {
          p_cart: string
          p_op: string
          p_payload: Json
          p_resultado: Json
        }
        Returns: undefined
      }
      _cc_chk_customer: { Args: { p_profile: string }; Returns: string }
      _cc_chk_direccion: {
        Args: { p_location: string; p_profile: string }
        Returns: Json
      }
      _cc_chk_direccion_snapshot: { Args: { p: Json }; Returns: Json }
      _cc_chk_evento: {
        Args: {
          p_cart: string
          p_detalle?: Json
          p_profile: string
          p_review: string
          p_tipo: string
        }
        Returns: undefined
      }
      _cc_chk_lineas: {
        Args: { p_cart: string; p_profile: string }
        Returns: Json
      }
      _cc_chk_resultado: {
        Args: { p_cart: string; p_idem: boolean; p_order: string }
        Returns: Json
      }
      _cc_chk_seller: { Args: { p_profile: string }; Returns: Json }
      _cc_conversacion_de: {
        Args: { p_profile: string; p_visitor: string }
        Returns: Json
      }
      _cc_es_admin: { Args: never; Returns: boolean }
      _cc_es_service: { Args: never; Returns: boolean }
      _cc_evento: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_detalle?: Json
          p_profile: string
          p_tipo: string
          p_visitor: string
        }
        Returns: undefined
      }
      _cc_evento_k: {
        Args: {
          p_accion: string
          p_detalle?: Json
          p_entidad: string
          p_id: string
          p_version: number
        }
        Returns: undefined
      }
      _cc_exige_admin: { Args: never; Returns: undefined }
      _cc_handoff_carrito: { Args: { p_cart: string }; Returns: Json }
      _cc_handoff_seguro: { Args: { p_cart: string }; Returns: Json }
      _cc_handoff_tras_adopcion: {
        Args: { p_profile: string }
        Returns: undefined
      }
      _cc_horario_estado: { Args: { p_ts?: string }; Returns: Json }
      _cc_ia_producto_vendible: {
        Args: { p_aud: string; p_product: string }
        Returns: Record<string, unknown>
      }
      _cc_ia_puede: { Args: { p_modo: string }; Returns: boolean }
      _cc_identidad: { Args: { p_product: string }; Returns: Json }
      _cc_nivel_seccion: { Args: { p_seccion: string }; Returns: string }
      _cc_norm: { Args: { p: string }; Returns: string }
      _cc_participante: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_rol: string
          p_visitor: string
        }
        Returns: undefined
      }
      _cc_perfil_activo: { Args: { p_profile: string }; Returns: string }
      _cc_producto_visible: {
        Args: { p_aud: string; p_product: string }
        Returns: boolean
      }
      _cc_puede_atender: { Args: { p_profile: string }; Returns: boolean }
      _cc_rutear: { Args: { p_conv: string }; Returns: Json }
      _cc_secciones_visibles: {
        Args: { p_aud: string; p_product: string }
        Returns: Json
      }
      _cc_sistema: {
        Args: { p_client_id: string; p_conv: string; p_texto: string }
        Returns: undefined
      }
      _cc_solo_servicio: { Args: never; Returns: undefined }
      _cc_texto_handoff: {
        Args: { p_configurado: boolean; p_en_horario: boolean }
        Returns: string
      }
      _cc_transicion_valida: {
        Args: { p_a: string; p_de: string }
        Returns: boolean
      }
      _cc_vendedor_de: { Args: { p_profile: string }; Returns: string }
      _cc_vendedor_elegible: {
        Args: { p_nuevos?: boolean; p_profile: string }
        Returns: boolean
      }
      _cc_visitor_por_hash: { Args: { p_hash: string }; Returns: string }
      _cc7_direccion: { Args: never; Returns: undefined }
      _comm_autorizar: { Args: never; Returns: string }
      _comm_encolar: {
        Args: {
          p_event_key: string
          p_order: string
          p_payload: Json
          p_plantilla: string
        }
        Returns: undefined
      }
      _comm_max_intentos: { Args: never; Returns: number }
      _comm_reclamo_caduco: { Args: never; Returns: string }
      _comm_ventana_idempotencia: { Args: never; Returns: string }
      _cuenta_suspendida: { Args: never; Returns: string }
      _fiscal_audit: {
        Args: { p_action: string; p_fiscal: Json; p_resource: string }
        Returns: undefined
      }
      _fiscal_clean: { Args: { p: Json }; Returns: Json }
      _fiscal_error: { Args: { p: Json }; Returns: string }
      _kpi_inicio: { Args: { p_dia: string }; Returns: string }
      _kpi_ventas: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          order_id: string
          total: number
        }[]
      }
      _norm_email: { Args: { p: string }; Returns: string }
      _norm_phone: { Args: { p: string }; Returns: string }
      _pf_autorizar: { Args: never; Returns: string }
      _pf_campos_editables: { Args: never; Returns: string[] }
      _pf_campos_materiales: { Args: never; Returns: string[] }
      _pf_faltantes: { Args: { p_product: string }; Returns: string[] }
      _pf_objeto_coherente: {
        Args: { p_objeto: string; p_trat: string }
        Returns: boolean
      }
      _pf_snapshot: { Args: { p_product: string }; Returns: Json }
      _salud_umbral_running: { Args: never; Returns: string }
      _salud_umbral_stale: { Args: never; Returns: string }
      _staff_objetivo: {
        Args: { p_uid: string }
        Returns: {
          active: boolean
          email: string | null
          full_name: string | null
          id: string
          meta: Json | null
          organization: string | null
          price_list_id: string | null
          role_id: string | null
          verified: boolean | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _w1_op_begin: {
        Args: { p_kind: string; p_op: string; p_req: Json }
        Returns: Json
      }
      _w1_op_finish: {
        Args: { p_kind: string; p_op: string; p_req: Json; p_result: Json }
        Returns: Json
      }
      _w1_trusted: { Args: { p_on: boolean }; Returns: undefined }
      _w2_asiento: {
        Args: {
          p_amount: number
          p_bank?: string
          p_claim?: string
          p_direction: string
          p_evidence?: string
          p_external_ref?: string
          p_id: string
          p_method: string
          p_notes?: string
          p_order: string
          p_refund?: string
          p_reversal_of?: string
          p_value_date: string
        }
        Returns: string
      }
      _w2_corte_cola: {
        Args: { p_alcance: string; p_cajero: string }
        Returns: {
          alcance: string
          cajero: string | null
          contado: number
          corte_desde: string | null
          corte_hasta: string | null
          created_at: string | null
          created_by: string | null
          diferencia: number
          esperado: number
          fecha: string
          fondo: number
          id: string
          motivo: string | null
          op_id: string | null
          prev_closing_id: string | null
          usuario: string | null
          void_reason: string | null
          voids_closing_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cash_closings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _w2_corte_desde: {
        Args: { p_alcance: string; p_cajero: string; p_fecha: string }
        Returns: string
      }
      _w2_efectivo_tramo: {
        Args: {
          p_alcance: string
          p_cajero: string
          p_desde: string
          p_hasta: string
        }
        Returns: number
      }
      _w2_op_begin: {
        Args: { p_kind: string; p_op: string; p_req: Json }
        Returns: Json
      }
      _w2_op_finish: {
        Args: { p_kind: string; p_op: string; p_req: Json; p_result: Json }
        Returns: Json
      }
      _w2_recalc_payment_status: { Args: { p_order: string }; Returns: string }
      _w2_trusted: { Args: { p_on: boolean }; Returns: undefined }
      _w2c_op_begin: {
        Args: { p_kind: string; p_op: string; p_req: Json }
        Returns: Json
      }
      _w2c_op_finish: {
        Args: { p_kind: string; p_op: string; p_req: Json; p_result: Json }
        Returns: Json
      }
      _w2c_perdida: {
        Args: {
          p_custody: string
          p_evidencia: string
          p_kind: string
          p_lot: string
          p_motivo: string
          p_op_id: string
          p_qty: number
        }
        Returns: string
      }
      _w2c_trusted: { Args: { p_on: boolean }; Returns: undefined }
      _w3_asignar_folio: {
        Args: { p_env: string; p_provider: string; p_rfc: string }
        Returns: string
      }
      _w3_edad_minima_sondeo: { Args: never; Returns: string }
      _w3_fingerprint: {
        Args: { p_order: string; p_receiver: Json }
        Returns: string
      }
      _w3_margen_replay: { Args: never; Returns: string }
      _w3_norm_legacy: { Args: { p: Json; p_email?: string }; Returns: Json }
      _w3_op_begin: {
        Args: { p_kind: string; p_op: string; p_req: Json }
        Returns: Json
      }
      _w3_op_finish: {
        Args: { p_kind: string; p_op: string; p_req: Json; p_result: Json }
        Returns: Json
      }
      _w3_plazo_timbrado: { Args: never; Returns: string }
      _w3_proyectar: { Args: { p_order: string }; Returns: undefined }
      _w3_receptor: {
        Args: { p_order: string; p_override?: Json }
        Returns: Json
      }
      _w3_replay_vence: { Args: { p_date_sent: string }; Returns: string }
      _w3_separacion_sondeos: { Args: never; Returns: string }
      _w3_transicion: {
        Args: {
          p_claim?: string
          p_doc: string
          p_error_code?: string
          p_error_message?: string
          p_event: string
          p_evidence?: Json
          p_folio?: string
          p_from_expected?: string
          p_op?: string
          p_provider_env?: string
          p_provider_ref?: string
          p_reason?: string
          p_reconcile_note?: string
          p_serie?: string
          p_stamped_at?: string
          p_to: string
          p_uuid?: string
        }
        Returns: Json
      }
      _w3_transicion_valida: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
      _w3_ventana_replay: { Args: never; Returns: string }
      abrir_custodia: {
        Args: {
          p_event_date?: string
          p_event_name?: string
          p_event_venue?: string
          p_holder_customer_id?: string
          p_holder_kind: string
          p_holder_user_id?: string
          p_kind: string
          p_op_id: string
        }
        Returns: Json
      }
      admin_approve_doctor: {
        Args: {
          p_customer_id?: string
          p_new_customer?: Json
          p_profile: string
        }
        Returns: Json
      }
      adoptar_cfdi: {
        Args: {
          p_doc_id: string
          p_evidencia?: string
          p_op_id: string
          p_provider_ref?: string
          p_sat_status?: string
          p_stamped_at?: string
          p_uuid: string
        }
        Returns: Json
      }
      ajustar_lote: {
        Args: {
          p_delta: number
          p_kind: string
          p_lot: string
          p_op_id: string
          p_reason: string
          p_receipt_id?: string
        }
        Returns: Json
      }
      anular_corte_caja: {
        Args: { p_closing_id: string; p_motivo: string; p_op_id: string }
        Returns: Json
      }
      anular_guia_manual: {
        Args: {
          p_attempt_id: string
          p_evidence?: string
          p_op_id: string
          p_reference: string
        }
        Returns: Json
      }
      aplicar_defaults_categoria: {
        Args: { p_categoria: string; p_op_id: string }
        Returns: Json
      }
      aplicar_defaults_familia: {
        Args: { p_familia: string; p_op_id: string }
        Returns: Json
      }
      app_role: { Args: never; Returns: string }
      apply_lot_movement: {
        Args: {
          p_change: number
          p_lot: string
          p_reason: string
          p_reference: string
        }
        Returns: undefined
      }
      auditoria_bajas: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: {
          actor: string
          actor_email: string
          actor_role: string
          cantidad: number
          created_at: string
          lote: string
          motivo: string
          movement_id: string
          sku: string
          tipo: string
        }[]
      }
      auth_role: { Args: never; Returns: string }
      autorizar_credito: {
        Args: {
          p_due_date: string
          p_motivo: string
          p_op_id: string
          p_order: string
        }
        Returns: Json
      }
      autorizar_reembolso: {
        Args: {
          p_monto: number
          p_motivo: string
          p_op_id: string
          p_order: string
          p_return_id?: string
          p_tipo: string
          p_usuario?: string
        }
        Returns: Json
      }
      avisar_lotes_por_caducar: { Args: never; Returns: number }
      buscar_prospecto_duplicado: {
        Args: { p_email: string; p_phone: string }
        Returns: string
      }
      can_access_conversation: { Args: { cid: string }; Returns: boolean }
      cancelar_pedido: {
        Args: { p_op_id: string; p_order: string; p_reason?: string }
        Returns: Json
      }
      cc_abrir_conversacion: {
        Args: { p_profile: string; p_visitor_hash: string }
        Returns: Json
      }
      cc_alias_guardar: {
        Args: { p_alias: string; p_product: string; p_tipo?: string }
        Returns: string
      }
      cc_alias_retirar: { Args: { p_id: string }; Returns: boolean }
      cc_asignar_asesor: {
        Args: { p_actor_profile: string; p_conv: string; p_seller: string }
        Returns: Json
      }
      cc_audiencia_actual: { Args: never; Returns: string }
      cc_buscar_conocimiento: {
        Args: { p_audiencia?: string; p_limite?: number; p_q: string }
        Returns: {
          entidad: string
          fragmento: string
          fuente: string
          nivel: string
          nombre: string
          product_id: string
          relevancia: number
          seccion: string
        }[]
      }
      cc_buscar_productos: {
        Args: { p_audiencia?: string; p_limite?: number; p_q: string }
        Returns: {
          categoria: string
          coincidencia: string
          es_familia: boolean
          familia: string
          linea: string
          nombre: string
          presentacion: string
          product_id: string
          puntaje: number
        }[]
      }
      cc_candidatos_recomendacion: {
        Args: {
          p_audiencia?: string
          p_categoria?: string
          p_familia?: string
          p_limite?: number
          p_terminos?: string[]
        }
        Returns: {
          categoria: string
          familia: string
          motivo: string
          nombre: string
          presentacion: string
          product_id: string
        }[]
      }
      cc_carrito_abrir: {
        Args: {
          p_actor_type: string
          p_conv?: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_carrito_actualizar: {
        Args: {
          p_actor_type: string
          p_cart: string
          p_op?: string
          p_product: string
          p_profile: string
          p_qty: number
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_carrito_agregar: {
        Args: {
          p_actor_type: string
          p_cart: string
          p_op?: string
          p_product: string
          p_profile: string
          p_qty: number
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_carrito_oferta: {
        Args: {
          p_accion: string
          p_actor_type: string
          p_cart: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_carrito_preparar_checkout: {
        Args: {
          p_actor_type: string
          p_cart: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_carrito_proyeccion: {
        Args: { p_cart: string; p_lector: string }
        Returns: Json
      }
      cc_carrito_quitar: {
        Args: {
          p_actor_type: string
          p_cart: string
          p_op?: string
          p_product: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_carrito_vaciar: {
        Args: {
          p_actor_type: string
          p_cart: string
          p_op?: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_carrito_ver: {
        Args: {
          p_actor_type: string
          p_cart: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_cartera_asignar: {
        Args: { p_cliente: string; p_motivo?: string; p_vendedor: string }
        Returns: Json
      }
      cc_cartera_listar: { Args: { p_filtro?: string }; Returns: Json }
      cc_catalogo_para_ia: {
        Args: { p_audiencia?: string; p_limite?: number }
        Returns: Json
      }
      cc_cerrar_conversacion: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_checkout_confirmar: {
        Args: {
          p_expected_rev?: number
          p_factura?: boolean
          p_operation: string
          p_perfil_fiscal?: string
          p_review: string
        }
        Returns: Json
      }
      cc_checkout_revisar: {
        Args: { p_cart: string; p_direccion?: Json; p_location_id?: string }
        Returns: Json
      }
      cc_cobertura: {
        Args: never
        Returns: {
          aprobadas: string[]
          borradores: string[]
          categoria: string
          es_padre: boolean
          faltantes_t0: string[]
          faltantes_t1: string[]
          familia: string
          nombre: string
          product_id: string
        }[]
      }
      cc_codigo_referido_crear: { Args: { p_seller: string }; Returns: string }
      cc_codigo_referido_revocar: { Args: { p_code: string }; Returns: boolean }
      cc_cola_asesorias: {
        Args: never
        Returns: {
          asesoria_solicitada_at: string
          cart_id: string
          conversation_id: string
          dueno: string
          edad_min: number
          es_mia: boolean
          fuera_horario: boolean
          handoff_origen: string
          iniciada: boolean
          last_message_at: string
          modo: string
          n_items: number
          ruteo_motivo: string
          seller_profile_id: string
          sin_leer: number
        }[]
      }
      cc_comparar_productos: {
        Args: { p_audiencia?: string; p_ids: string[] }
        Returns: Json
      }
      cc_config_t2: { Args: { p_habilitado: boolean }; Returns: boolean }
      cc_conocimiento_aprobar: {
        Args: { p_confirmar_clinico?: boolean; p_id: string }
        Returns: Json
      }
      cc_conocimiento_guardar: {
        Args: {
          p_audiencia?: string
          p_contenido: string
          p_datos?: Json
          p_id?: string
          p_product: string
          p_rev?: number
          p_seccion: string
          p_source?: string
        }
        Returns: Json
      }
      cc_conocimiento_listar: {
        Args: { p_product: string }
        Returns: {
          approved_at: string
          audiencia: string
          contenido: string
          created_at: string
          datos: Json
          estado: string
          fuente: string
          id: string
          importado_de: string
          nivel: string
          retired_at: string
          retired_reason: string
          rev: number
          seccion: string
          source_id: string
          version: number
        }[]
      }
      cc_conocimiento_restaurar: { Args: { p_id: string }; Returns: Json }
      cc_conocimiento_retirar: {
        Args: { p_id: string; p_motivo: string }
        Returns: Json
      }
      cc_empresa_aprobar: { Args: { p_id: string }; Returns: Json }
      cc_empresa_guardar: {
        Args: {
          p_audiencia?: string
          p_contenido: string
          p_id?: string
          p_rev?: number
          p_source?: string
          p_tema: string
          p_titulo: string
        }
        Returns: Json
      }
      cc_empresa_listar: {
        Args: never
        Returns: {
          approved_at: string
          audiencia: string
          contenido: string
          created_at: string
          estado: string
          id: string
          importado_de: string
          rev: number
          source_id: string
          tema: string
          titulo: string
          version: number
        }[]
      }
      cc_empresa_retirar: {
        Args: { p_id: string; p_motivo: string }
        Returns: Json
      }
      cc_enviar_mensaje: {
        Args: {
          p_actor_type: string
          p_client_id: string
          p_content: string
          p_conv: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_ficha_producto: {
        Args: { p_audiencia?: string; p_product: string }
        Returns: Json
      }
      cc_fuente_registrar: {
        Args: {
          p_documento_url?: string
          p_notas?: string
          p_referencia: string
          p_tipo: string
          p_version?: string
        }
        Returns: string
      }
      cc_fuentes_listar: {
        Args: never
        Returns: {
          captured_at: string
          documento_url: string
          id: string
          notas: string
          referencia: string
          tipo: string
          version: string
        }[]
      }
      cc_handoff_rechazar: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_horario_excepcion_borrar: { Args: { p_fecha: string }; Returns: Json }
      cc_horario_excepcion_guardar: {
        Args: {
          p_abre?: string
          p_cierra?: string
          p_fecha: string
          p_motivo?: string
          p_tipo: string
        }
        Returns: Json
      }
      cc_horario_guardar: {
        Args: { p_semana: Json; p_zona: string }
        Returns: Json
      }
      cc_horario_ver: { Args: never; Returns: Json }
      cc_ia_aviso_no_disponible: { Args: { p_conv: string }; Returns: Json }
      cc_ia_contexto_actor: { Args: { p_profile: string }; Returns: Json }
      cc_ia_disponibilidad: {
        Args: { p_product: string; p_profile: string }
        Returns: Json
      }
      cc_ia_estado_handoff: { Args: { p_conv: string }; Returns: Json }
      cc_ia_estado_pedido: {
        Args: { p_folio?: string; p_profile: string }
        Returns: Json
      }
      cc_ia_herramienta_registrar: {
        Args: {
          p_detalle?: Json
          p_product_ids?: string[]
          p_round: number
          p_status: string
          p_tool: string
          p_turn: string
        }
        Returns: string
      }
      cc_ia_precio: {
        Args: { p_product: string; p_profile: string; p_qty?: number }
        Returns: Json
      }
      cc_ia_turno_fallar: {
        Args: {
          p_desconocido?: boolean
          p_error_class: string
          p_input_tokens?: number
          p_intent?: string
          p_output_tokens?: number
          p_tool_rounds?: number
          p_turn: string
        }
        Returns: Json
      }
      cc_ia_turno_reclamar: {
        Args: {
          p_conv: string
          p_lease_segs?: number
          p_model: string
          p_provider: string
          p_trigger_seq: number
        }
        Returns: Json
      }
      cc_ia_turno_responder: {
        Args: {
          p_content: string
          p_evidencia?: string[]
          p_input_tokens?: number
          p_intent?: string
          p_output_tokens?: number
          p_tool_rounds?: number
          p_turn: string
        }
        Returns: Json
      }
      cc_importar_conocimiento_existente: { Args: never; Returns: Json }
      cc_iniciar_asesoria: {
        Args: { p_conv: string; p_profile: string }
        Returns: Json
      }
      cc_leer_conversacion: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_desde_seq?: number
          p_limite?: number
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_marcar_leido: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_seq: number
          p_visitor_hash: string
        }
        Returns: undefined
      }
      cc_reabrir_conversacion: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_reanudar_ia: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_relacion_guardar: {
        Args: {
          p_aprobar?: boolean
          p_nota?: string
          p_product: string
          p_related: string
          p_source?: string
          p_tipo: string
        }
        Returns: Json
      }
      cc_relacion_retirar: { Args: { p_id: string }; Returns: boolean }
      cc_revisar_claims: { Args: { p_texto: string }; Returns: Json }
      cc_ruteo_pendientes: { Args: never; Returns: Json }
      cc_ruteo_resumen: { Args: never; Returns: Json }
      cc_solicitar_asesor: {
        Args: {
          p_actor_type: string
          p_conv: string
          p_profile: string
          p_visitor_hash: string
        }
        Returns: Json
      }
      cc_terminar_asesoria: {
        Args: { p_conv: string; p_profile: string }
        Returns: Json
      }
      cc_vendedores: { Args: never; Returns: Json }
      cc_visitante_abrir: {
        Args: {
          p_attr?: Json
          p_hash: string
          p_hash_nuevo: string
          p_ref?: string
        }
        Returns: Json
      }
      cc_visitante_adoptar: {
        Args: { p_hash: string; p_profile: string }
        Returns: Json
      }
      cc_visitante_prospecto: {
        Args: { p_hash: string; p_prospect: string }
        Returns: boolean
      }
      cc_visitante_vincular_registro: {
        Args: { p_hash: string; p_profile: string }
        Returns: boolean
      }
      cc_visitantes_purgar: { Args: { p_dias?: number }; Returns: number }
      cerrar_custodia: {
        Args: { p_custody: string; p_motivo: string; p_op_id: string }
        Returns: Json
      }
      cerrar_orden_compra: {
        Args: { p_op_id: string; p_reason: string; p_replenishment: string }
        Returns: Json
      }
      cliente_360: { Args: { p_customer?: string }; Returns: Json }
      cliente_contacto_guardar: {
        Args: { p_customer: string; p_patch: Json }
        Returns: Json
      }
      cliente_fiscal_archivar: { Args: { p_perfil: string }; Returns: Json }
      cliente_fiscal_guardar: {
        Args: {
          p_customer: string
          p_datos: Json
          p_perfil: string
          p_predeterminado?: boolean
        }
        Returns: Json
      }
      cliente_fiscal_predeterminar: {
        Args: { p_perfil: string }
        Returns: Json
      }
      cliente_nota_agregar: {
        Args: { p_customer: string; p_texto: string }
        Returns: Json
      }
      cliente_perfiles_fiscales: {
        Args: { p_customer?: string }
        Returns: Json
      }
      cliente_telefono_archivar: { Args: { p_telefono: string }; Returns: Json }
      cliente_telefono_guardar: {
        Args: {
          p_customer: string
          p_etiqueta: string
          p_numero: string
          p_principal?: boolean
          p_telefono: string
        }
        Returns: Json
      }
      cliente_telefono_principal: {
        Args: { p_telefono: string }
        Returns: Json
      }
      cliente_ubicacion_adoptar_alta: {
        Args: { p_customer: string }
        Returns: Json
      }
      cliente_ubicacion_archivar: {
        Args: { p_ubicacion: string }
        Returns: Json
      }
      cliente_ubicacion_guardar: {
        Args: {
          p_customer: string
          p_datos: Json
          p_predeterminada?: boolean
          p_ubicacion: string
        }
        Returns: Json
      }
      cliente_ubicacion_predeterminar: {
        Args: { p_ubicacion: string }
        Returns: Json
      }
      comm_reclamar: {
        Args: { p_limite?: number }
        Returns: {
          claim_token: string
          id: string
          idempotency_key: string
          payload: Json
          plantilla: string
          to_address: string
          to_name: string
        }[]
      }
      comm_reintentar: {
        Args: { p_acepto_posible_duplicado?: boolean; p_id: string }
        Returns: Json
      }
      comm_resolver: {
        Args: {
          p_claim: string
          p_error?: string
          p_id: string
          p_message_id?: string
          p_provider?: string
          p_resultado: string
        }
        Returns: Json
      }
      conciliar_cfdi: {
        Args: never
        Returns: {
          check_id: string
          detalle: string
          entidad: string
          entidad_id: string
          severidad: string
        }[]
      }
      conciliar_custodia: {
        Args: never
        Returns: {
          check_id: string
          detalle: string
          entidad: string
          entidad_id: string
          esperado: number
          obtenido: number
          severidad: string
        }[]
      }
      conciliar_dinero: {
        Args: never
        Returns: {
          check_id: string
          detalle: string
          entidad: string
          entidad_id: string
          esperado: number
          obtenido: number
          severidad: string
        }[]
      }
      conciliar_inventario: {
        Args: never
        Returns: {
          check_id: string
          detalle: string
          entidad: string
          entidad_id: string
          esperado: number
          obtenido: number
          severidad: string
        }[]
      }
      confirmar_entrega: {
        Args: {
          p_proof_path?: string
          p_received_by?: string
          p_shipment_id: string
        }
        Returns: undefined
      }
      confirmar_reingreso: {
        Args: { p_lines: Json; p_op_id: string; p_return_id: string }
        Returns: Json
      }
      correr_alertas_diarias: { Args: never; Returns: Json }
      crear_pedido: {
        Args: {
          p_customer_id?: string
          p_doctor_id: string
          p_folio: string
          p_invoice_requested?: boolean
          p_lines: Json
          p_order_id: string
          p_shipping_meta?: Json
        }
        Returns: Json
      }
      custody_held: { Args: { p_lot: string }; Returns: number }
      custody_held_en: {
        Args: { p_custody: string; p_lot: string }
        Returns: number
      }
      definir_defaults_categoria: {
        Args: { p_cambios: Json; p_categoria: string; p_op_id: string }
        Returns: Json
      }
      definir_defaults_familia: {
        Args: { p_cambios: Json; p_familia: string; p_op_id: string }
        Returns: Json
      }
      descartar_solicitud_cfdi: {
        Args: { p_doc_id: string; p_motivo: string; p_op_id: string }
        Returns: Json
      }
      devolver_de_custodia: {
        Args: {
          p_custody: string
          p_lines: Json
          p_motivo?: string
          p_op_id: string
        }
        Returns: Json
      }
      dia_negocio: { Args: { p_instante: string }; Returns: string }
      disponer_devolucion: {
        Args: { p_lines: Json; p_op_id: string }
        Returns: Json
      }
      editar_fiscal_producto: {
        Args: {
          p_cambios: Json
          p_motivo?: string
          p_op_id: string
          p_product_id: string
        }
        Returns: Json
      }
      efectivo_esperado: {
        Args: { p_alcance?: string; p_cajero?: string; p_fecha: string }
        Returns: number
      }
      entregar_custodia: {
        Args: { p_custody: string; p_lines: Json; p_op_id: string }
        Returns: Json
      }
      estado_custodia: { Args: { p_custody: string }; Returns: Json }
      estado_dinero_pedido: { Args: { p_order: string }; Returns: Json }
      estado_fiscal_pedido: { Args: { p_order: string }; Returns: Json }
      estado_operacion_custodia: { Args: { p_op_id: string }; Returns: Json }
      estado_operacion_dinero: { Args: { p_op_id: string }; Returns: Json }
      estado_validacion_fiscal: {
        Args: never
        Returns: {
          advertencias: string[]
          categoria: string
          clave_prod_serv: string
          clave_unidad: string
          descripcion_fiscal: string
          evidencia_historica: string
          faltantes: string[]
          iva_tasa: number
          nombre: string
          objeto_imp: string
          precio_final: number
          precio_historico: number
          precio_publicado: number
          product_id: string
          sku: string
          tratamiento_iva: string
          unidad_comercial: string
          validado: boolean
          validado_at: string
          validado_por_nombre: string
        }[]
      }
      evidencia_inexistencia_cfdi: { Args: { p_doc_id: string }; Returns: Json }
      excepciones_evidencia_fiscal: {
        Args: never
        Returns: {
          advertencia: string
          clasificacion: string
          filas: number
          mapeo_estado: string
          procedencia: string
          productos: number
        }[]
      }
      finalize_shipment: {
        Args: { p_attempt_id: string; p_shipment: Json }
        Returns: Json
      }
      has_cap: { Args: { cap: string }; Returns: boolean }
      hoy_local: { Args: never; Returns: string }
      identidad_cfdi: { Args: { p_doc_id: string }; Returns: Json }
      importar_evidencia_precios: {
        Args: { p_filas: Json; p_op_id: string }
        Returns: Json
      }
      importar_lote: {
        Args: {
          p_caducidad: string
          p_cantidad: number
          p_lote: string
          p_op_id: string
          p_sku: string
        }
        Returns: Json
      }
      inv_estado_operacion: { Args: { p_op_id: string }; Returns: Json }
      invalidar_fiscal_producto: {
        Args: { p_motivo: string; p_op_id: string; p_product_id: string }
        Returns: Json
      }
      is_order_driver: { Args: { o_id: string }; Returns: boolean }
      is_verified: { Args: never; Returns: boolean }
      kpi_por_cobrar: { Args: never; Returns: Json }
      kpi_resultado: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: Json
      }
      kpi_ventas: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: Json
      }
      log_audit: {
        Args: {
          p_action: string
          p_actor_name: string
          p_detail: string
          p_resource: string
        }
        Returns: undefined
      }
      lote_caducado: { Args: { p_expiry: string }; Returns: boolean }
      lote_code_norm: { Args: { p_code: string }; Returns: string }
      norm_telefono_mx: { Args: { p: string }; Returns: string }
      order_owner: { Args: { o_id: string }; Returns: string }
      order_vendor_email: { Args: { o_id: string }; Returns: string }
      pagar_reembolso: {
        Args: {
          p_method: string
          p_motivo_via?: string
          p_op_id: string
          p_reference?: string
          p_refund_id: string
          p_value_date?: string
        }
        Returns: Json
      }
      pay_order: {
        Args: { p_method: string; p_order: string; p_ref: string }
        Returns: undefined
      }
      pedido_fiscalmente_listo: {
        Args: { p_order: string }
        Returns: {
          faltantes: string[]
          nombre: string
          product_id: string
          sku: string
        }[]
      }
      pedido_liberado_para_surtir: {
        Args: { p_order: string }
        Returns: boolean
      }
      pedido_visible: { Args: { p_order: string }; Returns: boolean }
      precio_de:
        | { Args: { p_list: string; p_product: string }; Returns: number }
        | {
            Args: { p_list: string; p_product: string; p_qty: number }
            Returns: number
          }
      puede_ver_precio: { Args: never; Returns: boolean }
      rate_limit_hit: {
        Args: {
          p_cost?: number
          p_limit: number
          p_scope: string
          p_subject: string
          p_window_secs: number
        }
        Returns: Json
      }
      reactivar_staff: { Args: { p_uid: string }; Returns: Json }
      recibir_devolucion: {
        Args: {
          p_lines: Json
          p_notes?: string
          p_op_id: string
          p_order: string
        }
        Returns: Json
      }
      recibir_lote: {
        Args: {
          p_caducidad: string
          p_cantidad: number
          p_evidence?: string
          p_kind?: string
          p_lote: string
          p_op_id: string
          p_product: string
          p_reason?: string
          p_replenishment_id?: string
          p_unit_cost?: number
        }
        Returns: Json
      }
      reclamar_cfdi: {
        Args: {
          p_claim_id?: string
          p_doc_id: string
          p_op_id: string
          p_provider_env: string
        }
        Returns: Json
      }
      registrar_cobro: {
        Args: {
          p_amount: number
          p_bank_account_id?: string
          p_evidence?: string
          p_method: string
          p_op_id: string
          p_order: string
          p_reference?: string
          p_value_date?: string
        }
        Returns: Json
      }
      registrar_corte_caja: {
        Args: {
          p_alcance: string
          p_cajero?: string
          p_contado: number
          p_fecha: string
          p_fondo: number
          p_motivo?: string
          p_op_id: string
        }
        Returns: Json
      }
      registrar_perdida_custodia: {
        Args: {
          p_custody: string
          p_evidencia?: string
          p_kind: string
          p_lines: Json
          p_motivo: string
          p_op_id: string
        }
        Returns: Json
      }
      registrar_resultado_cfdi: {
        Args: {
          p_claim_id: string
          p_doc_id: string
          p_error_code?: string
          p_error_message?: string
          p_op_id: string
          p_provider_ref?: string
          p_resultado: string
          p_stamped_at?: string
          p_uuid?: string
        }
        Returns: Json
      }
      registrar_sondeo_cfdi: {
        Args: {
          p_candidates?: number
          p_detail?: string
          p_doc_id: string
          p_op_id: string
          p_outcome: string
          p_probe_kind: string
          p_sat_status?: string
          p_uuid?: string
        }
        Returns: Json
      }
      reportar_pago: {
        Args: {
          p_amount: number
          p_bank_account_id?: string
          p_method: string
          p_op_id: string
          p_order: string
          p_proof_path?: string
          p_reference?: string
        }
        Returns: Json
      }
      resolve_customer_identity: {
        Args: {
          p_email?: string
          p_external_id?: string
          p_name?: string
          p_phone?: string
          p_profile_id?: string
          p_source?: string
        }
        Returns: Json
      }
      resolver_cfdi_inexistente: {
        Args: { p_doc_id: string; p_motivo: string; p_op_id: string }
        Returns: Json
      }
      reversar_asiento: {
        Args: { p_entry_id: string; p_motivo: string; p_op_id: string }
        Returns: Json
      }
      revisar_pago: {
        Args: {
          p_accion: string
          p_amount_verificado?: number
          p_claim_id: string
          p_motivo?: string
          p_op_id: string
          p_value_date?: string
        }
        Returns: Json
      }
      revocar_credito: {
        Args: { p_motivo: string; p_op_id: string; p_order: string }
        Returns: Json
      }
      salud_sistema: { Args: never; Returns: Json }
      set_doctor_default_location: {
        Args: { p_location_id: string }
        Returns: undefined
      }
      set_order_fiscal_snapshot: {
        Args: { p_order_id: string; p_receiver: Json }
        Returns: Json
      }
      siguiente_folio: { Args: never; Returns: string }
      solicitar_cfdi: {
        Args: { p_op_id: string; p_order_id: string; p_receiver?: Json }
        Returns: Json
      }
      surtir_pedido: {
        Args: { p_allocations: Json; p_op_id: string; p_order: string }
        Returns: Json
      }
      suspender_staff: {
        Args: { p_baja?: boolean; p_motivo: string; p_uid: string }
        Returns: Json
      }
      tramo_corte_caja: {
        Args: { p_alcance?: string; p_cajero?: string; p_fecha: string }
        Returns: Json
      }
      upsert_customer_contact: {
        Args: { p_customer_id: string; p_patch: Json }
        Returns: Json
      }
      upsert_customer_fiscal: {
        Args: { p_customer_id: string; p_fiscal: Json }
        Returns: Json
      }
      validar_fiscal_producto: {
        Args: {
          p_fuente: string
          p_notas?: string
          p_op_id: string
          p_product_id: string
        }
        Returns: Json
      }
      vender_pos: {
        Args: {
          p_allocations: Json
          p_custody_id?: string
          p_customer_id?: string
          p_doctor_id: string
          p_efectivo_recibido?: number
          p_folio: string
          p_invoice_meta?: Json
          p_invoice_requested?: boolean
          p_lines: Json
          p_order_id: string
          p_payment_method: string
          p_shipping_meta: Json
          p_total: number
        }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
