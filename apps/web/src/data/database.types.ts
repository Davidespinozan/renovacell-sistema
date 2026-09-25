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
          contado: number
          created_at: string | null
          created_by: string | null
          diferencia: number
          esperado: number
          fecha: string
          fondo: number
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
          fondo?: number
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
          fondo?: number
          id?: string
          motivo?: string | null
          usuario?: string | null
        }
        Relationships: []
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
          name: string
          neighborhood: string | null
          postal_code: string
          reference_notes: string | null
          state: string
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
          name: string
          neighborhood?: string | null
          postal_code: string
          reference_notes?: string | null
          state: string
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
          name?: string
          neighborhood?: string | null
          postal_code?: string
          reference_notes?: string | null
          state?: string
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
          unit_cost: number | null
        }
        Insert: {
          change: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          lot_id?: string | null
          reason?: string | null
          reference?: string | null
          unit_cost?: number | null
        }
        Update: {
          change?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          lot_id?: string | null
          reason?: string | null
          reference?: string | null
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
          caducidad_avisada_at: string | null
          expiry_date: string | null
          id: string
          location: string | null
          lot_code: string
          manufacture_date: string | null
          metadata: Json | null
          product_id: string | null
          quantity: number
          unit_cost: number | null
        }
        Insert: {
          caducidad_avisada_at?: string | null
          expiry_date?: string | null
          id?: string
          location?: string | null
          lot_code: string
          manufacture_date?: string | null
          metadata?: Json | null
          product_id?: string | null
          quantity?: number
          unit_cost?: number | null
        }
        Update: {
          caducidad_avisada_at?: string | null
          expiry_date?: string | null
          id?: string
          location?: string | null
          lot_code?: string
          manufacture_date?: string | null
          metadata?: Json | null
          product_id?: string | null
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
      refunds: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          items: Json | null
          metodo: string | null
          monto: number
          motivo: string
          order_id: string
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
          order_id: string
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
          order_id?: string
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
          provider_meta: Json | null
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
          provider_meta?: Json | null
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
          provider_meta?: Json | null
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
    }
    Functions: {
      admin_approve_doctor: {
        Args: {
          p_customer_id?: string
          p_new_customer?: Json
          p_profile: string
        }
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
      auth_role: { Args: never; Returns: string }
      avisar_cuentas_por_cobrar: { Args: never; Returns: number }
      avisar_lotes_por_caducar: { Args: never; Returns: number }
      can_access_conversation: { Args: { cid: string }; Returns: boolean }
      confirmar_entrega: {
        Args: {
          p_proof_path?: string
          p_received_by?: string
          p_shipment_id: string
        }
        Returns: undefined
      }
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
      event_sell: { Args: { p_event: string; p_sales: Json }; Returns: boolean }
      has_cap: { Args: { cap: string }; Returns: boolean }
      importar_lote: {
        Args: {
          p_caducidad: string
          p_cantidad: number
          p_lote: string
          p_sku: string
          p_ubicacion: string
        }
        Returns: Json
      }
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
      precio_de:
        | { Args: { p_list: string; p_product: string }; Returns: number }
        | {
            Args: { p_list: string; p_product: string; p_qty: number }
            Returns: number
          }
      recibir_lote: {
        Args: {
          p_caducidad: string
          p_cantidad: number
          p_lote: string
          p_product: string
          p_reason?: string
          p_reference?: string
          p_replenishment_id?: string
          p_ubicacion: string
          p_unit_cost?: number
        }
        Returns: Json
      }
      registrar_devolucion: {
        Args: {
          p_items?: Json
          p_monto: number
          p_motivo: string
          p_order_id: string
          p_tipo: string
          p_usuario?: string
        }
        Returns: Json
      }
      set_doctor_default_location: {
        Args: { p_location_id: string }
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
      vender_pos: {
        Args: {
          p_allocations: Json
          p_customer_id?: string
          p_doctor_id: string
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
