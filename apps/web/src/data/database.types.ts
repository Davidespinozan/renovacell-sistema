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
          contado: number
          created_at: string | null
          created_by: string | null
          diferencia: number
          esperado: number
          fecha: string
          id: string
          motivo: string | null
          usuario: string | null
        }
        Insert: {
          alcance: string
          contado: number
          created_at?: string | null
          created_by?: string | null
          diferencia: number
          esperado: number
          fecha: string
          id?: string
          motivo?: string | null
          usuario?: string | null
        }
        Update: {
          alcance?: string
          contado?: number
          created_at?: string | null
          created_by?: string | null
          diferencia?: number
          esperado?: number
          fecha?: string
          id?: string
          motivo?: string | null
          usuario?: string | null
        }
        Relationships: []
      }
      consignment_stock: {
        Row: {
          assigned: number
          id: string
          lots: Json
          product_id: string | null
          sold: number
          updated_at: string | null
          vendor: string
        }
        Insert: {
          assigned?: number
          id?: string
          lots?: Json
          product_id?: string | null
          sold?: number
          updated_at?: string | null
          vendor: string
        }
        Update: {
          assigned?: number
          id?: string
          lots?: Json
          product_id?: string | null
          sold?: number
          updated_at?: string | null
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "consignment_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
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
      events: {
        Row: {
          created_at: string | null
          created_by: string | null
          date: string | null
          id: string
          items: Json
          members: Json
          name: string
          status: string
          venue: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date?: string | null
          id?: string
          items?: Json
          members?: Json
          name: string
          status?: string
          venue?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date?: string | null
          id?: string
          items?: Json
          members?: Json
          name?: string
          status?: string
          venue?: string | null
        }
        Relationships: []
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
      inventory_movements: {
        Row: {
          change: number
          created_at: string | null
          created_by: string | null
          id: string
          lot_id: string | null
          reason: string | null
          reference: string | null
        }
        Insert: {
          change: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          lot_id?: string | null
          reason?: string | null
          reference?: string | null
        }
        Update: {
          change?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          lot_id?: string | null
          reason?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
        ]
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
          expiry_date: string | null
          id: string
          location: string | null
          lot_code: string
          manufacture_date: string | null
          metadata: Json | null
          product_id: string | null
          quantity: number
        }
        Insert: {
          expiry_date?: string | null
          id?: string
          location?: string | null
          lot_code: string
          manufacture_date?: string | null
          metadata?: Json | null
          product_id?: string | null
          quantity?: number
        }
        Update: {
          expiry_date?: string | null
          id?: string
          location?: string | null
          lot_code?: string
          manufacture_date?: string | null
          metadata?: Json | null
          product_id?: string | null
          quantity?: number
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
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
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
          created_at: string | null
          currency: string | null
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
          created_at?: string | null
          currency?: string | null
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
          created_at?: string | null
          currency?: string | null
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
      products: {
        Row: {
          active: boolean
          brochure_url: string | null
          category: string | null
          description: string | null
          id: string
          image_url: string | null
          line: string | null
          metadata: Json | null
          name: string
          price: number | null
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
          id?: string
          image_url?: string | null
          line?: string | null
          metadata?: Json | null
          name: string
          price?: number | null
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
          id?: string
          image_url?: string | null
          line?: string | null
          metadata?: Json | null
          name?: string
          price?: number | null
          show_landing?: boolean
          show_portal?: boolean
          sku?: string
          unit?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
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
          email: string | null
          id: string
          meta: Json | null
          name: string | null
          phone: string | null
          source: string | null
          status: string | null
        }
        Insert: {
          assigned_to?: string | null
          cedula?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          meta?: Json | null
          name?: string | null
          phone?: string | null
          source?: string | null
          status?: string | null
        }
        Update: {
          assigned_to?: string | null
          cedula?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          meta?: Json | null
          name?: string | null
          phone?: string | null
          source?: string | null
          status?: string | null
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
        ]
      }
      replenishments: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          kind: string
          paid: boolean
          product_id: string | null
          product_name: string | null
          qty: number
          status: string
          supplier: string | null
          unit_cost: number
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          kind: string
          paid?: boolean
          product_id?: string | null
          product_name?: string | null
          qty: number
          status?: string
          supplier?: string | null
          unit_cost: number
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          kind?: string
          paid?: boolean
          product_id?: string | null
          product_name?: string | null
          qty?: number
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
      shipments: {
        Row: {
          carrier: string | null
          created_at: string | null
          delivered_at: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          driver_id: string | null
          estimated_delivery_at: string | null
          id: string
          incident: Json | null
          label_url: string | null
          load_confirmed_at: string | null
          order_id: string | null
          proof_image_url: string | null
          received_by: string | null
          status: string | null
          tracking_number: string | null
        }
        Insert: {
          carrier?: string | null
          created_at?: string | null
          delivered_at?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          driver_id?: string | null
          estimated_delivery_at?: string | null
          id?: string
          incident?: Json | null
          label_url?: string | null
          load_confirmed_at?: string | null
          order_id?: string | null
          proof_image_url?: string | null
          received_by?: string | null
          status?: string | null
          tracking_number?: string | null
        }
        Update: {
          carrier?: string | null
          created_at?: string | null
          delivered_at?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          driver_id?: string | null
          estimated_delivery_at?: string | null
          id?: string
          incident?: Json | null
          label_url?: string | null
          load_confirmed_at?: string | null
          order_id?: string | null
          proof_image_url?: string | null
          received_by?: string | null
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
          name: string | null
        }
        Insert: {
          brochure_url?: string | null
          category?: string | null
          description?: string | null
          id?: string | null
          image_url?: string | null
          line?: string | null
          name?: string | null
        }
        Update: {
          brochure_url?: string | null
          category?: string | null
          description?: string | null
          id?: string | null
          image_url?: string | null
          line?: string | null
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
          id: string | null
          image_url: string | null
          line: string | null
          name: string | null
          price: number | null
          show_landing: boolean | null
          show_portal: boolean | null
          sku: string | null
          unit: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          description?: string | null
          id?: string | null
          image_url?: string | null
          line?: string | null
          name?: string | null
          price?: number | null
          show_landing?: boolean | null
          show_portal?: boolean | null
          sku?: string | null
          unit?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          description?: string | null
          id?: string | null
          image_url?: string | null
          line?: string | null
          name?: string | null
          price?: number | null
          show_landing?: boolean | null
          show_portal?: boolean | null
          sku?: string | null
          unit?: string | null
        }
        Relationships: []
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
    }
    Functions: {
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
      auth_role: { Args: never; Returns: string }
      can_access_conversation: { Args: { cid: string }; Returns: boolean }
      confirmar_entrega: {
        Args: {
          p_proof_path?: string
          p_received_by?: string
          p_shipment_id: string
        }
        Returns: undefined
      }
      event_sell: { Args: { p_event: string; p_sales: Json }; Returns: boolean }
      has_cap: { Args: { cap: string }; Returns: boolean }
      is_order_driver: { Args: { o_id: string }; Returns: boolean }
      is_verified: { Args: never; Returns: boolean }
      log_audit: {
        Args: {
          p_action: string
          p_actor_name: string
          p_detail: string
          p_resource: string
        }
        Returns: undefined
      }
      order_owner: { Args: { o_id: string }; Returns: string }
      order_vendor_email: { Args: { o_id: string }; Returns: string }
      pay_order: {
        Args: { p_method: string; p_order: string; p_ref: string }
        Returns: undefined
      }
      surtir_pedido: {
        Args: {
          p_allocations: Json
          p_item_lots: Json
          p_order: string
          p_ref: string
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
