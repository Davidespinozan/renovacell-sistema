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
            referencedRelation: "profiles"
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
            referencedRelation: "profiles"
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
          product_id: string | null
          sold: number
          updated_at: string | null
          vendor: string
        }
        Insert: {
          assigned?: number
          id?: string
          product_id?: string | null
          sold?: number
          updated_at?: string | null
          vendor: string
        }
        Update: {
          assigned?: number
          id?: string
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
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      products: {
        Row: {
          active: boolean
          category: string | null
          description: string | null
          id: string
          image_url: string | null
          line: string | null
          metadata: Json | null
          name: string
          price: number | null
          sku: string
          unit: string | null
        }
        Insert: {
          active?: boolean
          category?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          line?: string | null
          metadata?: Json | null
          name: string
          price?: number | null
          sku: string
          unit?: string | null
        }
        Update: {
          active?: boolean
          category?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          line?: string | null
          metadata?: Json | null
          name?: string
          price?: number | null
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
          role_id: string | null
          verified: boolean | null
        }
        Insert: {
          email?: string | null
          full_name?: string | null
          id: string
          meta?: Json | null
          organization?: string | null
          role_id?: string | null
          verified?: boolean | null
        }
        Update: {
          email?: string | null
          full_name?: string | null
          id?: string
          meta?: Json | null
          organization?: string | null
          role_id?: string | null
          verified?: boolean | null
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
            referencedRelation: "profiles"
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
            referencedRelation: "profiles"
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
          sku?: string | null
          unit?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
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
