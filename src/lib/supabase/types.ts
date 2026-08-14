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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      actions: {
        Row: {
          client_id: string
          created_at: string
          deadline: string | null
          description: string
          erp_area: string | null
          evidence: string | null
          id: string
          meeting_id: string | null
          owner_name: string | null
          priority: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          deadline?: string | null
          description: string
          erp_area?: string | null
          evidence?: string | null
          id?: string
          meeting_id?: string | null
          owner_name?: string | null
          priority?: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          deadline?: string | null
          description?: string
          erp_area?: string | null
          evidence?: string | null
          id?: string
          meeting_id?: string | null
          owner_name?: string | null
          priority?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "actions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_applications: {
        Row: {
          analysis_id: string | null
          applied_by: string | null
          client_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          meeting_id: string
          project_id: string | null
          result: Json
        }
        Insert: {
          analysis_id?: string | null
          applied_by?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          meeting_id: string
          project_id?: string | null
          result?: Json
        }
        Update: {
          analysis_id?: string | null
          applied_by?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          meeting_id?: string
          project_id?: string | null
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "analysis_applications_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "meeting_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_applications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_applications_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_applications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          account_status: string
          active: boolean
          company_name: string
          consultant_id: string | null
          created_at: string
          current_quadrant: string | null
          current_risk_level: string
          current_risk_score: number
          current_satisfaction: number | null
          current_value_score: number | null
          id: string
          last_meeting_date: string | null
          next_meeting_date: string | null
          notes: string | null
          segment: string | null
          start_date: string | null
          updated_at: string
        }
        Insert: {
          account_status?: string
          active?: boolean
          company_name: string
          consultant_id?: string | null
          created_at?: string
          current_quadrant?: string | null
          current_risk_level?: string
          current_risk_score?: number
          current_satisfaction?: number | null
          current_value_score?: number | null
          id?: string
          last_meeting_date?: string | null
          next_meeting_date?: string | null
          notes?: string | null
          segment?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: string
          active?: boolean
          company_name?: string
          consultant_id?: string | null
          created_at?: string
          current_quadrant?: string | null
          current_risk_level?: string
          current_risk_score?: number
          current_satisfaction?: number | null
          current_value_score?: number | null
          id?: string
          last_meeting_date?: string | null
          next_meeting_date?: string | null
          notes?: string | null
          segment?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          meeting_id: string | null
          owner: string | null
          project_id: string
          reason: string | null
          status: string
          supersedes_decision_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meeting_id?: string | null
          owner?: string | null
          project_id: string
          reason?: string | null
          status?: string
          supersedes_decision_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meeting_id?: string | null
          owner?: string | null
          project_id?: string
          reason?: string | null
          status?: string
          supersedes_decision_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_supersedes_decision_id_fkey"
            columns: ["supersedes_decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_mentions: {
        Row: {
          analysis_id: string | null
          client_id: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          id: string
          meeting_id: string | null
          mention_type: string
          new_value: Json | null
          previous_value: Json | null
          project_id: string | null
          reason: string | null
        }
        Insert: {
          analysis_id?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          meeting_id?: string | null
          mention_type?: string
          new_value?: Json | null
          previous_value?: Json | null
          project_id?: string | null
          reason?: string | null
        }
        Update: {
          analysis_id?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          meeting_id?: string | null
          mention_type?: string
          new_value?: Json | null
          previous_value?: Json | null
          project_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_mentions_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "meeting_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_analyses: {
        Row: {
          agenda: Json
          analysis: Json
          approved_at: string | null
          approved_by: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          meeting_id: string
          project_id: string | null
          provider: string
          status: string
          transcript: string | null
          updated_at: string
        }
        Insert: {
          agenda?: Json
          analysis?: Json
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          meeting_id: string
          project_id?: string | null
          provider?: string
          status?: string
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          agenda?: Json
          analysis?: Json
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          meeting_id?: string
          project_id?: string | null
          provider?: string
          status?: string
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_analyses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_analyses_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_evolution: {
        Row: {
          analysis_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          meeting_id: string
          movement: string
          previous_meeting_id: string | null
          project_id: string
          summary: Json
          updated_at: string
        }
        Insert: {
          analysis_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_id: string
          movement?: string
          previous_meeting_id?: string | null
          project_id: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          analysis_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_id?: string
          movement?: string
          previous_meeting_id?: string | null
          project_id?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_evolution_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "meeting_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_evolution_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_evolution_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_evolution_previous_meeting_id_fkey"
            columns: ["previous_meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_evolution_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_evolution_items: {
        Row: {
          classification: string
          client_id: string | null
          confidence: number | null
          created_at: string
          current_state: string | null
          entity_id: string | null
          entity_type: string
          evidence: string | null
          evolution_id: string
          id: string
          label: string
          meeting_id: string | null
          previous_state: string | null
          project_id: string
          source: string
        }
        Insert: {
          classification: string
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          current_state?: string | null
          entity_id?: string | null
          entity_type: string
          evidence?: string | null
          evolution_id: string
          id?: string
          label: string
          meeting_id?: string | null
          previous_state?: string | null
          project_id: string
          source?: string
        }
        Update: {
          classification?: string
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          current_state?: string | null
          entity_id?: string | null
          entity_type?: string
          evidence?: string | null
          evolution_id?: string
          id?: string
          label?: string
          meeting_id?: string | null
          previous_state?: string | null
          project_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_evolution_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_evolution_items_evolution_id_fkey"
            columns: ["evolution_id"]
            isOneToOne: false
            referencedRelation: "meeting_evolution"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_evolution_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_evolution_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          action_deadline: string | null
          action_owner: string | null
          analysis_quadrant: string | null
          analysis_risk_level: string | null
          calculated_risk_level: string
          calculated_risk_score: number
          client_id: string
          continuity_doubt: boolean
          created_at: string
          created_by: string | null
          executive_summary: string | null
          expansion_opportunity: string | null
          explicit_complaint: boolean
          has_measurable_result: boolean
          id: string
          import_hash: string | null
          low_client_adherence: boolean
          main_pain: string | null
          main_priority: string | null
          main_result: string | null
          measurable_result: string | null
          meeting_date: string
          meeting_type: string | null
          missing_internal_owner: boolean
          next_action: string | null
          participants: string[]
          project_id: string | null
          satisfaction_classification: string | null
          satisfaction_justification: string | null
          satisfaction_score: number | null
          satisfaction_trend: string | null
          transcript_hash: string | null
          transcript_key: string | null
          value_justification: string | null
          value_score: number | null
        }
        Insert: {
          action_deadline?: string | null
          action_owner?: string | null
          analysis_quadrant?: string | null
          analysis_risk_level?: string | null
          calculated_risk_level?: string
          calculated_risk_score?: number
          client_id: string
          continuity_doubt?: boolean
          created_at?: string
          created_by?: string | null
          executive_summary?: string | null
          expansion_opportunity?: string | null
          explicit_complaint?: boolean
          has_measurable_result?: boolean
          id?: string
          import_hash?: string | null
          low_client_adherence?: boolean
          main_pain?: string | null
          main_priority?: string | null
          main_result?: string | null
          measurable_result?: string | null
          meeting_date: string
          meeting_type?: string | null
          missing_internal_owner?: boolean
          next_action?: string | null
          participants?: string[]
          project_id?: string | null
          satisfaction_classification?: string | null
          satisfaction_justification?: string | null
          satisfaction_score?: number | null
          satisfaction_trend?: string | null
          transcript_hash?: string | null
          transcript_key?: string | null
          value_justification?: string | null
          value_score?: number | null
        }
        Update: {
          action_deadline?: string | null
          action_owner?: string | null
          analysis_quadrant?: string | null
          analysis_risk_level?: string | null
          calculated_risk_level?: string
          calculated_risk_score?: number
          client_id?: string
          continuity_doubt?: boolean
          created_at?: string
          created_by?: string | null
          executive_summary?: string | null
          expansion_opportunity?: string | null
          explicit_complaint?: boolean
          has_measurable_result?: boolean
          id?: string
          import_hash?: string | null
          low_client_adherence?: boolean
          main_pain?: string | null
          main_priority?: string | null
          main_result?: string | null
          measurable_result?: string | null
          meeting_date?: string
          meeting_type?: string | null
          missing_internal_owner?: boolean
          next_action?: string | null
          participants?: string[]
          project_id?: string | null
          satisfaction_classification?: string | null
          satisfaction_justification?: string | null
          satisfaction_score?: number | null
          satisfaction_trend?: string | null
          transcript_hash?: string | null
          transcript_key?: string | null
          value_justification?: string | null
          value_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meetings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          client_id: string
          created_at: string
          description: string
          expected_benefit: string | null
          id: string
          meeting_id: string | null
          status: string
        }
        Insert: {
          client_id: string
          created_at?: string
          description: string
          expected_benefit?: string | null
          id?: string
          meeting_id?: string | null
          status?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          description?: string
          expected_benefit?: string | null
          id?: string
          meeting_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      orchestrator_recommendations: {
        Row: {
          alternative_agent: Database["public"]["Enums"]["orchestrator_agent"] | null
          alternative_reason: string | null
          approved_at: string | null
          approved_by: string | null
          client_id: string
          confidence: number
          created_at: string
          created_by: string | null
          erp_classification: Json
          evidence: Json
          expected_result: string
          id: string
          main_bottleneck: Json
          project_id: string
          project_stage: Database["public"]["Enums"]["orchestrator_stage"]
          reason: string
          recommended_agent: Database["public"]["Enums"]["orchestrator_agent"]
          source: string
          state_hash: string
          status: Database["public"]["Enums"]["orchestrator_status"]
        }
        Insert: {
          alternative_agent?: Database["public"]["Enums"]["orchestrator_agent"] | null
          alternative_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          erp_classification?: Json
          evidence?: Json
          expected_result?: string
          id?: string
          main_bottleneck?: Json
          project_id: string
          project_stage: Database["public"]["Enums"]["orchestrator_stage"]
          reason?: string
          recommended_agent: Database["public"]["Enums"]["orchestrator_agent"]
          source?: string
          state_hash: string
          status?: Database["public"]["Enums"]["orchestrator_status"]
        }
        Update: {
          alternative_agent?: Database["public"]["Enums"]["orchestrator_agent"] | null
          alternative_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          erp_classification?: Json
          evidence?: Json
          expected_result?: string
          id?: string
          main_bottleneck?: Json
          project_id?: string
          project_stage?: Database["public"]["Enums"]["orchestrator_stage"]
          reason?: string
          recommended_agent?: Database["public"]["Enums"]["orchestrator_agent"]
          source?: string
          state_hash?: string
          status?: Database["public"]["Enums"]["orchestrator_status"]
        }
        Relationships: [
          {
            foreignKeyName: "orchestrator_recommendations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orchestrator_recommendations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      project_context: {
        Row: {
          constraints: Json
          created_at: string
          current_scenario: string | null
          executive_summary: string | null
          hypotheses: Json
          id: string
          last_meeting_id: string | null
          main_objective: string | null
          next_steps: Json
          objectives: Json
          priorities: Json
          problems: Json
          project_id: string
          results: Json
          root_causes: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          constraints?: Json
          created_at?: string
          current_scenario?: string | null
          executive_summary?: string | null
          hypotheses?: Json
          id?: string
          last_meeting_id?: string | null
          main_objective?: string | null
          next_steps?: Json
          objectives?: Json
          priorities?: Json
          problems?: Json
          project_id: string
          results?: Json
          root_causes?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          constraints?: Json
          created_at?: string
          current_scenario?: string | null
          executive_summary?: string | null
          hypotheses?: Json
          id?: string
          last_meeting_id?: string | null
          main_objective?: string | null
          next_steps?: Json
          objectives?: Json
          priorities?: Json
          problems?: Json
          project_id?: string
          results?: Json
          root_causes?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_context_last_meeting_id_fkey"
            columns: ["last_meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_context_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_dedupe_log: {
        Row: {
          analysis_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          event: string
          id: string
          merged_from_project_id: string | null
          project_id: string | null
          reason: string | null
        }
        Insert: {
          analysis_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          event: string
          id?: string
          merged_from_project_id?: string | null
          project_id?: string | null
          reason?: string | null
        }
        Update: {
          analysis_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          event?: string
          id?: string
          merged_from_project_id?: string | null
          project_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_dedupe_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_dedupe_log_merged_from_project_id_fkey"
            columns: ["merged_from_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_dedupe_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_health_snapshots: {
        Row: {
          analysis_id: string | null
          breakdown: Json
          client_id: string | null
          created_at: string
          created_by: string | null
          health_status: string
          id: string
          intervention_priority: string
          meeting_id: string | null
          movement: string | null
          project_id: string
          reasons: Json
          score: number
        }
        Insert: {
          analysis_id?: string | null
          breakdown?: Json
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          health_status: string
          id?: string
          intervention_priority: string
          meeting_id?: string | null
          movement?: string | null
          project_id: string
          reasons?: Json
          score: number
        }
        Update: {
          analysis_id?: string | null
          breakdown?: Json
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          health_status?: string
          id?: string
          intervention_priority?: string
          meeting_id?: string | null
          movement?: string | null
          project_id?: string
          reasons?: Json
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_health_snapshots_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "meeting_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_health_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_health_snapshots_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_health_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_id: string
          consultant_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          merged_into_project_id: string | null
          name: string
          normalized_name: string | null
          start_date: string | null
          status: string
          target_end_date: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          merged_into_project_id?: string | null
          name: string
          normalized_name?: string | null
          start_date?: string | null
          status?: string
          target_end_date?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          merged_into_project_id?: string | null
          name?: string
          normalized_name?: string | null
          start_date?: string | null
          status?: string
          target_end_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_merged_into_project_id_fkey"
            columns: ["merged_into_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_rules: {
        Row: {
          active: boolean
          description: string | null
          id: string
          points: number
          rule_key: string
          rule_name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          description?: string | null
          id?: string
          points?: number
          rule_key: string
          rule_name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          description?: string | null
          id?: string
          points?: number
          rule_key?: string
          rule_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      risks: {
        Row: {
          active: boolean
          client_id: string
          created_at: string
          description: string
          id: string
          level: string
          meeting_id: string | null
        }
        Insert: {
          active?: boolean
          client_id: string
          created_at?: string
          description: string
          id?: string
          level?: string
          meeting_id?: string | null
        }
        Update: {
          active?: boolean
          client_id?: string
          created_at?: string
          description?: string
          id?: string
          level?: string
          meeting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      can_access_client: {
        Args: { _client_id: string }
        Returns: boolean
      }
      can_access_meeting: {
        Args: { _meeting_id: string }
        Returns: boolean
      }
      can_access_project: {
        Args: { _project_id: string }
        Returns: boolean
      }
      get_or_create_project: {
        Args: {
          p_analysis_id?: string
          p_client_id: string
          p_description?: string
          p_name: string
        }
        Returns: Json
      }
      get_or_create_smart_meeting: {
        Args: {
          p_client_id: string
          p_executive_summary?: string
          p_meeting_date: string
          p_meeting_type?: string
          p_participants?: string[]
          p_project_id: string
          p_transcript_hash: string
          p_transcript_key: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_meeting: {
        Args: {
          p_actions?: Json
          p_meeting: Json
          p_opportunities?: Json
          p_risks?: Json
        }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      merge_context_list: { Args: { a: Json; b: Json }; Returns: Json }
      normalize_project_name: { Args: { p_name: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "consultant"
      orchestrator_agent:
        | "CRITERIOS_SUCESSO"
        | "DIAGNOSTICO_EXECUTIVO"
        | "PARETO_ORDEM_ATAQUE"
        | "ENTREGA_CONSULTIVA"
        | "IMPLANTACAO_CONSULTIVA"
        | "CONTINUIDADE_GERENCIAL"
        | "AUDITOR_QUALIDADE"
      orchestrator_stage:
        | "SEM_DIRECAO"
        | "EM_DIAGNOSTICO"
        | "AGUARDANDO_PRIORIZACAO"
        | "SOLUCAO_DEFINIDA"
        | "EM_IMPLANTACAO"
        | "EM_ACOMPANHAMENTO"
        | "TRAVADO"
        | "EM_VALIDACAO"
      orchestrator_status: "suggested" | "approved" | "rejected" | "executed" | "superseded"
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
      app_role: ["admin", "consultant"],
      orchestrator_agent: [
        "CRITERIOS_SUCESSO",
        "DIAGNOSTICO_EXECUTIVO",
        "PARETO_ORDEM_ATAQUE",
        "ENTREGA_CONSULTIVA",
        "IMPLANTACAO_CONSULTIVA",
        "CONTINUIDADE_GERENCIAL",
        "AUDITOR_QUALIDADE",
      ],
      orchestrator_stage: [
        "SEM_DIRECAO",
        "EM_DIAGNOSTICO",
        "AGUARDANDO_PRIORIZACAO",
        "SOLUCAO_DEFINIDA",
        "EM_IMPLANTACAO",
        "EM_ACOMPANHAMENTO",
        "TRAVADO",
        "EM_VALIDACAO",
      ],
      orchestrator_status: ["suggested", "approved", "rejected", "executed", "superseded"],
    },
  },
} as const
