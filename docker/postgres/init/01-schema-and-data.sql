--
-- PostgreSQL database dump
--

-- Dumped from database version 17.8
-- Dumped by pg_dump version 17.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: enforce_single_done_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_single_done_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_done = true THEN
    IF EXISTS (
      SELECT 1 FROM columns
      WHERE project_id = NEW.project_id AND is_done = true AND id != NEW.id
    ) THEN
      RAISE EXCEPTION 'Only one column per project can be marked as done';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prevent_activity_log_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_activity_log_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'activity_log is append-only: UPDATE operations are not allowed';
  END IF;
  -- Allow DELETE (needed for CASCADE from tasks/projects)
  RETURN OLD;
END;
$$;


--
-- Name: update_task_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_task_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    actor_id uuid,
    actor_label text DEFAULT 'System'::text,
    action_type text NOT NULL,
    field text,
    old_value text,
    new_value text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clickup_user_id text,
    name text NOT NULL,
    email text,
    avatar_url text,
    active boolean DEFAULT true,
    role text DEFAULT 'agent'::text,
    github_email text,
    created_at timestamp with time zone DEFAULT now(),
    bonus_earned numeric(10,2) DEFAULT 0,
    password_hash text
);


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text NOT NULL,
    job_title text NOT NULL,
    job_url text,
    job_description text,
    budget_type text,
    budget_min numeric(10,2),
    budget_max numeric(10,2),
    hourly_min numeric(10,2),
    hourly_max numeric(10,2),
    skills text[],
    client_country text,
    client_rating numeric(3,2),
    client_total_spent numeric(12,2),
    client_hires integer,
    posted_at timestamp with time zone,
    received_at timestamp with time zone DEFAULT now(),
    profile_id text,
    agent_id uuid,
    clickup_task_id text,
    clickup_task_url text,
    status text DEFAULT 'Proposal Ready'::text,
    proposal_text text,
    gpt_model text,
    gpt_tokens_used integer,
    instruction_version text,
    outcome text,
    won_value numeric(10,2),
    proposal_sent_at timestamp with time zone,
    outcome_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    connects_used integer DEFAULT 0,
    priority character varying(10) DEFAULT 'low'::character varying,
    rejection_reason character varying(100),
    stage_entered_at timestamp with time zone,
    task_id uuid,
    meeting_booked_at timestamp with time zone
);


--
-- Name: agent_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.agent_stats AS
 SELECT a.id,
    a.name,
    a.clickup_user_id,
    count(j.id) AS total_jobs,
    count(
        CASE
            WHEN (j.proposal_sent_at IS NOT NULL) THEN 1
            ELSE NULL::integer
        END) AS proposals_sent,
    count(
        CASE
            WHEN (j.outcome = 'won'::text) THEN 1
            ELSE NULL::integer
        END) AS won,
    count(
        CASE
            WHEN (j.outcome = 'lost'::text) THEN 1
            ELSE NULL::integer
        END) AS lost,
    round((((count(
        CASE
            WHEN (j.outcome = 'won'::text) THEN 1
            ELSE NULL::integer
        END))::numeric / (NULLIF(count(
        CASE
            WHEN (j.outcome = ANY (ARRAY['won'::text, 'lost'::text])) THEN 1
            ELSE NULL::integer
        END), 0))::numeric) * (100)::numeric), 1) AS win_rate_pct,
    COALESCE(sum(
        CASE
            WHEN (j.outcome = 'won'::text) THEN j.won_value
            ELSE NULL::numeric
        END), (0)::numeric) AS total_revenue,
    avg(
        CASE
            WHEN (j.proposal_sent_at IS NOT NULL) THEN (EXTRACT(epoch FROM (j.proposal_sent_at - j.received_at)) / (3600)::numeric)
            ELSE NULL::numeric
        END) AS avg_response_hours
   FROM (public.agents a
     LEFT JOIN public.jobs j ON ((j.agent_id = a.id)))
  GROUP BY a.id, a.name, a.clickup_user_id;


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alert_type text NOT NULL,
    message text NOT NULL,
    current_value numeric,
    threshold_value numeric,
    dismissed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: checklist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    title text NOT NULL,
    is_checked boolean DEFAULT false,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: columns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.columns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    color character varying(7) DEFAULT '#6b7280'::character varying,
    is_done boolean DEFAULT false,
    wip_limit integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    author_id uuid NOT NULL,
    parent_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: custom_field_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_field_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    field_type text NOT NULL,
    options jsonb,
    required boolean DEFAULT false,
    "position" integer DEFAULT 0 NOT NULL,
    archived boolean DEFAULT false,
    show_on_card boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT custom_field_definitions_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'dropdown'::text, 'multi_select'::text, 'date'::text, 'boolean'::text])))
);


--
-- Name: file_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    filename text NOT NULL,
    url text NOT NULL,
    blob_path text,
    size_bytes integer,
    mime_type text,
    thumbnail_url text,
    uploader_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    notification_type text NOT NULL,
    in_app boolean DEFAULT true,
    email boolean DEFAULT true
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id text NOT NULL,
    profile_name text NOT NULL,
    stack text,
    vollna_filter_tag text,
    agent_id uuid,
    clickup_list_id text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    niche character varying(50),
    connects_budget integer DEFAULT 150,
    platform text DEFAULT 'Upwork'::text
);


--
-- Name: profile_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.profile_stats AS
 SELECT p.id,
    p.profile_id,
    p.profile_name,
    p.stack,
    count(j.id) AS total_jobs,
    count(
        CASE
            WHEN (j.outcome = 'won'::text) THEN 1
            ELSE NULL::integer
        END) AS won,
    round((((count(
        CASE
            WHEN (j.outcome = 'won'::text) THEN 1
            ELSE NULL::integer
        END))::numeric / (NULLIF(count(
        CASE
            WHEN (j.outcome = ANY (ARRAY['won'::text, 'lost'::text])) THEN 1
            ELSE NULL::integer
        END), 0))::numeric) * (100)::numeric), 1) AS win_rate_pct,
    avg(
        CASE
            WHEN (j.outcome = 'won'::text) THEN j.won_value
            ELSE NULL::numeric
        END) AS avg_won_value,
    COALESCE(sum(
        CASE
            WHEN (j.outcome = 'won'::text) THEN j.won_value
            ELSE NULL::numeric
        END), (0)::numeric) AS total_revenue
   FROM (public.profiles p
     LEFT JOIN public.jobs j ON ((j.profile_id = p.profile_id)))
  GROUP BY p.id, p.profile_id, p.profile_name, p.stack;


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    project_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    CONSTRAINT project_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb,
    sort jsonb DEFAULT '{}'::jsonb,
    shared boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: stats_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stats_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cache_key text NOT NULL,
    data jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone
);


--
-- Name: sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    records_synced integer DEFAULT 0,
    records_updated integer DEFAULT 0,
    errors text[],
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    status text DEFAULT 'running'::text
);


--
-- Name: task_assignees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_assignees (
    task_id uuid NOT NULL,
    agent_id uuid NOT NULL
);


--
-- Name: task_tag_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_tag_map (
    task_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: task_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    color character varying(7) DEFAULT '#6b7280'::character varying
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    column_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    priority text,
    due_date timestamp with time zone,
    start_date timestamp with time zone,
    "position" integer DEFAULT 0 NOT NULL,
    creator_id uuid,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tasks_priority_check CHECK ((priority = ANY (ARRAY['urgent'::text, 'high'::text, 'medium'::text, 'low'::text])))
);


--
-- Name: webhook_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    inbound_api_key_hash text,
    field_map jsonb DEFAULT '{}'::jsonb,
    outbound_url text,
    outbound_secret text,
    outbound_events text[] DEFAULT '{}'::text[],
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: webhook_event_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_event_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    direction text NOT NULL,
    event_type text,
    status_code integer,
    payload jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT webhook_event_log_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Data for Name: activity_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.activity_log (id, task_id, actor_id, actor_label, action_type, field, old_value, new_value, metadata, created_at) FROM stdin;
7349b59a-042b-4a5a-b05b-782b7af10654	e2af9b78-ac83-4048-8277-285240bdc455	\N	System	task_created	\N	\N	Test Task	{}	2026-04-09 09:16:27.596852-04
53985ab5-ec45-4d91-b9b9-5bc00287eaa6	e2af9b78-ac83-4048-8277-285240bdc455	\N	System	task_moved	column	Todo	Proposal Submitted	{}	2026-04-09 09:16:50.527223-04
f23d51ab-ece3-459e-9b38-abb83dbb3988	e2af9b78-ac83-4048-8277-285240bdc455	\N	System	task_moved	column	Proposal Submitted	Prototype Done	{}	2026-04-09 09:17:05.507097-04
\.


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agents (id, clickup_user_id, name, email, avatar_url, active, role, github_email, created_at, bonus_earned, password_hash) FROM stdin;
19747506-adb8-4076-b203-860342f1f208	\N	Mubashir	mubashir.ahmed@ikonicsolution.com	\N	t	agent	\N	2026-04-09 08:53:07.921054-04	0.00	7e5302d58a3469b54435e4acf8afb96f:e6a16ec5753f86d53238e9cf5445c53eed08922474beb46f85c90a3ae3d9f8bbc7b5920f68380688ca5354bab6e298caa0803973e0eac4ccfc622b2eaeee6fb8
feb0d599-f3cc-4149-9d13-652d047e6859	\N	Shayan	shayanjaved@ikonicsolution.com	\N	t	agent	\N	2026-04-09 08:53:07.931491-04	0.00	828a6b54cf1c50b15f142f30a8be689b:6f6b18b6c571c287e31140e9a9ff1406ef6e4f8d96e54b762b090a4f25357615c3d46e4679d7a5c49f1e4cf5e7c76b063d56837395e1709890d8fac77c0b69aa
3107fd41-c2b5-400d-b704-6e99cf7947a0	\N	Muqadass	muqadass@ikonicsolution.com	\N	t	agent	\N	2026-04-09 08:53:07.931941-04	0.00	7c686fef2d4869a90842e5d089b3f5c1:cfc4cd062dac6e07893d6154b21a915cc92047c5ec32cb41db90f5451587dbcf4e437a13ba9991ecc4f51abc6cfe44dcb3e5e280a0194ee4b535b6d5a7b6c385
0249847f-8f08-4649-9fbb-90b302b34966	\N	Abu Bakher	abubakarali@ikonicsolution.com	\N	t	agent	\N	2026-04-09 08:53:07.932311-04	0.00	afd5eb21edd6f5da8081638c1e9a7787:d1e8fcaa20457fd150041604bebbbf0f233262eef81fa5ad9f649e53f9e355d05be78afadc6bc209a71a6296721e0a0bf823ee63a38abe4e5ebc49a1a85a390f
16b7e932-191a-45de-8a80-a0ee59960557	\N	Saba	saba_ishrat@ikonicsolution.com	\N	t	agent	\N	2026-04-09 08:53:07.932673-04	0.00	f095fdd7ffba5292e1e3f1ad5b0cd12c:2ae4ed122d46c4c70adf5a7ea3ee12dca450dadc06d4317e096901bf56409120f2c9ba58c1269c03b1769f33a5a880091c98c452f7ccce9040da3a58e108be59
\.


--
-- Data for Name: alerts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.alerts (id, alert_type, message, current_value, threshold_value, dismissed, created_at) FROM stdin;
\.


--
-- Data for Name: checklist_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.checklist_items (id, task_id, title, is_checked, "position", created_at) FROM stdin;
\.


--
-- Data for Name: columns; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.columns (id, project_id, name, "position", color, is_done, wip_limit, created_at) FROM stdin;
59b5f493-c62a-4db8-ad83-0ae6f7abb2c0	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Todo	1000	#6b7280	f	\N	2026-04-09 09:14:13.760242-04
0737a1db-1ede-4ff6-8e7a-4f91a55fb275	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Proposal Submitted	2000	#3b82f6	f	\N	2026-04-09 09:14:13.812259-04
c7723cf3-f2e2-4eb0-8e43-c013bf4a5f9e	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Prototype Required	3000	#eab308	f	\N	2026-04-09 09:14:13.820784-04
22f7c5a9-6722-45c1-92ce-262698b6c29c	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Prototype Done	4000	#22c55e	f	\N	2026-04-09 09:14:13.827189-04
08e9b4f0-96dc-44c9-a293-59c076d11551	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Prototype Submitted	5000	#14b8a6	f	\N	2026-04-09 09:14:13.830061-04
c4fb6773-d679-45dd-aa13-8fe44a1370b1	aea826cb-f6ff-40a0-8d22-3cd94142f52a	In Chat	6000	#8b5cf6	f	\N	2026-04-09 09:14:13.835329-04
8be25b8e-2fc6-4b4a-8971-196768c86cb0	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Meeting Scheduled	7000	#6366f1	f	\N	2026-04-09 09:14:13.838661-04
bfb68a84-6a08-431a-af2a-e33a2020df7b	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Meeting Done	8000	#06b6d4	f	\N	2026-04-09 09:14:13.842252-04
7ae33ea4-386e-447f-b6f2-123fd049d0b3	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Negotiation	9000	#f97316	f	\N	2026-04-09 09:14:13.845546-04
aedb01cd-ae56-40ec-a80a-2f4bf9fd0d34	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Lost	10000	#ef4444	f	\N	2026-04-09 09:14:13.847636-04
5f789a58-fac9-457e-b720-8b89844e6776	aea826cb-f6ff-40a0-8d22-3cd94142f52a	On Hold	11000	#f59e0b	f	\N	2026-04-09 09:14:13.849787-04
aac6c2b3-01d4-4ee1-852b-a4231c2757f6	aea826cb-f6ff-40a0-8d22-3cd94142f52a	N/A	12000	#9ca3af	f	\N	2026-04-09 09:14:13.853881-04
9d9ed188-279e-41b1-ad04-bf213f8c5b9c	aea826cb-f6ff-40a0-8d22-3cd94142f52a	Won	13000	#10b981	t	\N	2026-04-09 09:14:13.857484-04
55c4ed70-5dc3-484c-a0ea-46af31f80b35	5174ff4b-5524-4db2-99d7-a0f03448a6db	Todo	1000	#6b7280	f	\N	2026-04-09 09:14:33.975694-04
bb76c2ca-eade-486c-8cfc-85dec06f047e	5174ff4b-5524-4db2-99d7-a0f03448a6db	Proposal Submitted	2000	#3b82f6	f	\N	2026-04-09 09:14:33.979777-04
36edfd13-83a1-4539-a50e-f33ae54dd42c	5174ff4b-5524-4db2-99d7-a0f03448a6db	Prototype Required	3000	#eab308	f	\N	2026-04-09 09:14:33.98166-04
20a799d3-63f1-4db0-a7cb-ee72e2d37791	5174ff4b-5524-4db2-99d7-a0f03448a6db	Prototype Done	4000	#22c55e	f	\N	2026-04-09 09:14:33.983061-04
26ff4dba-d4c0-434a-9140-bad8713441ed	5174ff4b-5524-4db2-99d7-a0f03448a6db	Prototype Submitted	5000	#14b8a6	f	\N	2026-04-09 09:14:33.984537-04
cb1a4fea-9da3-436a-86d7-d719278265b9	5174ff4b-5524-4db2-99d7-a0f03448a6db	In Chat	6000	#8b5cf6	f	\N	2026-04-09 09:14:33.985944-04
4794fd06-7d2e-421a-85c0-16ec2b773d2f	5174ff4b-5524-4db2-99d7-a0f03448a6db	Meeting Scheduled	7000	#6366f1	f	\N	2026-04-09 09:14:33.987239-04
8212b83a-4eee-48bf-9fe3-8b3a851f81a6	5174ff4b-5524-4db2-99d7-a0f03448a6db	Meeting Done	8000	#06b6d4	f	\N	2026-04-09 09:14:33.988497-04
686b0b26-e55a-4d12-8bd5-5084813f9ff1	5174ff4b-5524-4db2-99d7-a0f03448a6db	Negotiation	9000	#f97316	f	\N	2026-04-09 09:14:33.989742-04
297f4c79-d5f5-4b17-9cb5-f82cb81fd8cd	5174ff4b-5524-4db2-99d7-a0f03448a6db	Lost	10000	#ef4444	f	\N	2026-04-09 09:14:33.990838-04
1529771b-caeb-4ba2-b48f-d0524ae7d546	5174ff4b-5524-4db2-99d7-a0f03448a6db	On Hold	11000	#f59e0b	f	\N	2026-04-09 09:14:33.992142-04
b8de82ef-82ca-4da9-a34c-dd6deef859ff	5174ff4b-5524-4db2-99d7-a0f03448a6db	N/A	12000	#9ca3af	f	\N	2026-04-09 09:14:33.993709-04
ba2e3a55-e3e3-4b0d-8abe-b8903f9a9359	5174ff4b-5524-4db2-99d7-a0f03448a6db	Won	13000	#10b981	t	\N	2026-04-09 09:14:33.995709-04
\.


--
-- Data for Name: comments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.comments (id, task_id, author_id, parent_id, body, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: custom_field_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.custom_field_definitions (id, project_id, name, field_type, options, required, "position", archived, show_on_card, created_at) FROM stdin;
\.


--
-- Data for Name: file_attachments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.file_attachments (id, task_id, filename, url, blob_path, size_bytes, mime_type, thumbnail_url, uploader_id, created_at) FROM stdin;
\.


--
-- Data for Name: jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.jobs (id, job_id, job_title, job_url, job_description, budget_type, budget_min, budget_max, hourly_min, hourly_max, skills, client_country, client_rating, client_total_spent, client_hires, posted_at, received_at, profile_id, agent_id, clickup_task_id, clickup_task_url, status, proposal_text, gpt_model, gpt_tokens_used, instruction_version, outcome, won_value, proposal_sent_at, outcome_at, created_at, updated_at, connects_used, priority, rejection_reason, stage_entered_at, task_id, meeting_booked_at) FROM stdin;
\.


--
-- Data for Name: notification_preferences; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notification_preferences (user_id, notification_type, in_app, email) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notifications (id, user_id, type, title, body, link, read, created_at) FROM stdin;
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.profiles (id, profile_id, profile_name, stack, vollna_filter_tag, agent_id, clickup_list_id, active, created_at, niche, connects_budget, platform) FROM stdin;
69cce995-3170-4a6d-adb3-577fc718e11f	sana	Sana	WordPress, PHP, WooCommerce	sana-profile-webhook	19747506-adb8-4076-b203-860342f1f208	\N	t	2026-04-09 09:10:32.161159-04	\N	150	Upwork
63eda6b6-3811-4c7c-a96a-57434883aa77	laiba	Laiba	React, Next.js, TypeScript	laiba-profile-webhook	3107fd41-c2b5-400d-b704-6e99cf7947a0	\N	t	2026-04-09 09:10:32.161159-04	\N	150	Upwork
83c8bffb-96ad-4838-ac06-8fb06ae7eae3	khansa	Khansa	Full Stack, Node.js, React	khansa-profile-webhook	feb0d599-f3cc-4149-9d13-652d047e6859	\N	t	2026-04-09 09:10:32.161159-04	\N	150	Upwork
cd9ba666-35f0-41ea-ad15-66b307b23e63	saim	Saim	Python, Django, FastAPI	saim-profile-webhook	feb0d599-f3cc-4149-9d13-652d047e6859	\N	t	2026-04-09 09:10:32.161159-04	\N	150	Upwork
c3836e04-d2cf-4eb5-aa37-76f324149662	shayan	Shayan	DevOps, AWS, Docker	shayan-profile-webhook	0249847f-8f08-4649-9fbb-90b302b34966	\N	t	2026-04-09 09:10:32.161159-04	\N	150	Upwork
37b211a8-9af2-44cb-bf20-91afec65954f	craig	Craig	Mobile, React Native, Flutter	craig-profile-webhook	19747506-adb8-4076-b203-860342f1f208	\N	t	2026-04-09 09:10:32.161159-04	\N	150	Upwork
8619b1cc-0f45-4977-a2e0-f5863c81e8d7	rebekah	Rebekah	UI/UX, Frontend, Figma	rebekah-profile-webhook	0249847f-8f08-4649-9fbb-90b302b34966	\N	t	2026-04-09 09:10:32.161159-04	\N	150	Upwork
107385d4-8617-41ca-b916-1382398e86b4	nawal	Nawal	Data, Analytics, Python	nawal-profile-webhook	16b7e932-191a-45de-8a80-a0ee59960557	\N	t	2026-04-09 09:10:32.161159-04	\N	150	Upwork
\.


--
-- Data for Name: project_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_members (project_id, agent_id, role, joined_at) FROM stdin;
aea826cb-f6ff-40a0-8d22-3cd94142f52a	19747506-adb8-4076-b203-860342f1f208	member	2026-04-09 09:14:13.734938-04
aea826cb-f6ff-40a0-8d22-3cd94142f52a	feb0d599-f3cc-4149-9d13-652d047e6859	member	2026-04-09 09:14:13.742241-04
aea826cb-f6ff-40a0-8d22-3cd94142f52a	3107fd41-c2b5-400d-b704-6e99cf7947a0	member	2026-04-09 09:14:13.745825-04
aea826cb-f6ff-40a0-8d22-3cd94142f52a	0249847f-8f08-4649-9fbb-90b302b34966	member	2026-04-09 09:14:13.751265-04
aea826cb-f6ff-40a0-8d22-3cd94142f52a	16b7e932-191a-45de-8a80-a0ee59960557	member	2026-04-09 09:14:13.755871-04
5174ff4b-5524-4db2-99d7-a0f03448a6db	19747506-adb8-4076-b203-860342f1f208	admin	2026-04-09 09:14:33.97344-04
5174ff4b-5524-4db2-99d7-a0f03448a6db	0249847f-8f08-4649-9fbb-90b302b34966	member	2026-04-09 09:14:47.137545-04
5174ff4b-5524-4db2-99d7-a0f03448a6db	3107fd41-c2b5-400d-b704-6e99cf7947a0	member	2026-04-09 09:14:50.267708-04
5174ff4b-5524-4db2-99d7-a0f03448a6db	feb0d599-f3cc-4149-9d13-652d047e6859	member	2026-04-09 09:14:53.497378-04
5174ff4b-5524-4db2-99d7-a0f03448a6db	16b7e932-191a-45de-8a80-a0ee59960557	member	2026-04-09 09:14:57.729478-04
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.projects (id, workspace_id, name, description, created_at, updated_at) FROM stdin;
aea826cb-f6ff-40a0-8d22-3cd94142f52a	27975794-e681-4476-8bf0-4d9dd86f6a71	Task Board	Default task management board	2026-04-09 09:14:13.724511-04	2026-04-09 09:14:13.724511-04
5174ff4b-5524-4db2-99d7-a0f03448a6db	27975794-e681-4476-8bf0-4d9dd86f6a71	Rising Lions	Rising Lions	2026-04-09 09:14:33.971046-04	2026-04-09 09:14:33.971046-04
\.


--
-- Data for Name: saved_views; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.saved_views (id, project_id, owner_id, name, filters, sort, shared, created_at) FROM stdin;
\.


--
-- Data for Name: stats_cache; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stats_cache (id, cache_key, data, computed_at, expires_at) FROM stdin;
\.


--
-- Data for Name: sync_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sync_log (id, source, records_synced, records_updated, errors, started_at, completed_at, status) FROM stdin;
\.


--
-- Data for Name: task_assignees; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_assignees (task_id, agent_id) FROM stdin;
e2af9b78-ac83-4048-8277-285240bdc455	feb0d599-f3cc-4149-9d13-652d047e6859
\.


--
-- Data for Name: task_tag_map; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_tag_map (task_id, tag_id) FROM stdin;
\.


--
-- Data for Name: task_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_tags (id, project_id, name, color) FROM stdin;
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tasks (id, project_id, column_id, title, description, priority, due_date, start_date, "position", creator_id, custom_fields, created_at, updated_at) FROM stdin;
e2af9b78-ac83-4048-8277-285240bdc455	5174ff4b-5524-4db2-99d7-a0f03448a6db	20a799d3-63f1-4db0-a7cb-ee72e2d37791	Test Task	\N	\N	2026-04-09 09:16:00-04	\N	1000	\N	{"_connects_used": 5}	2026-04-09 09:16:27.587418-04	2026-04-09 09:17:05.498285-04
\.


--
-- Data for Name: webhook_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.webhook_configs (id, project_id, inbound_api_key_hash, field_map, outbound_url, outbound_secret, outbound_events, active, created_at) FROM stdin;
\.


--
-- Data for Name: webhook_event_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.webhook_event_log (id, project_id, direction, event_type, status_code, payload, error, created_at) FROM stdin;
\.


--
-- Data for Name: workspaces; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workspaces (id, name, slug, owner_id, created_at) FROM stdin;
27975794-e681-4476-8bf0-4d9dd86f6a71	Rising Lion	rising-lion	19747506-adb8-4076-b203-860342f1f208	2026-04-09 09:14:13.713746-04
\.


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: agents agents_clickup_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_clickup_user_id_key UNIQUE (clickup_user_id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: checklist_items checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_pkey PRIMARY KEY (id);


--
-- Name: columns columns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.columns
    ADD CONSTRAINT columns_pkey PRIMARY KEY (id);


--
-- Name: columns columns_project_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.columns
    ADD CONSTRAINT columns_project_id_name_key UNIQUE (project_id, name);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: custom_field_definitions custom_field_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_pkey PRIMARY KEY (id);


--
-- Name: file_attachments file_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_job_id_key UNIQUE (job_id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id, notification_type);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_profile_id_key UNIQUE (profile_id);


--
-- Name: profiles profiles_vollna_filter_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_vollna_filter_tag_key UNIQUE (vollna_filter_tag);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (project_id, agent_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: saved_views saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_pkey PRIMARY KEY (id);


--
-- Name: stats_cache stats_cache_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stats_cache
    ADD CONSTRAINT stats_cache_cache_key_key UNIQUE (cache_key);


--
-- Name: stats_cache stats_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stats_cache
    ADD CONSTRAINT stats_cache_pkey PRIMARY KEY (id);


--
-- Name: sync_log sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_pkey PRIMARY KEY (id);


--
-- Name: task_assignees task_assignees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignees
    ADD CONSTRAINT task_assignees_pkey PRIMARY KEY (task_id, agent_id);


--
-- Name: task_tag_map task_tag_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tag_map
    ADD CONSTRAINT task_tag_map_pkey PRIMARY KEY (task_id, tag_id);


--
-- Name: task_tags task_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tags
    ADD CONSTRAINT task_tags_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: webhook_configs webhook_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_configs
    ADD CONSTRAINT webhook_configs_pkey PRIMARY KEY (id);


--
-- Name: webhook_event_log webhook_event_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_event_log
    ADD CONSTRAINT webhook_event_log_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: idx_activity_log_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_task ON public.activity_log USING btree (task_id, created_at DESC);


--
-- Name: idx_alerts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_created_at ON public.alerts USING btree (created_at DESC);


--
-- Name: idx_alerts_dismissed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_dismissed ON public.alerts USING btree (dismissed);


--
-- Name: idx_attachments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachments_task ON public.file_attachments USING btree (task_id);


--
-- Name: idx_checklist_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checklist_task ON public.checklist_items USING btree (task_id, "position");


--
-- Name: idx_columns_project_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_columns_project_position ON public.columns USING btree (project_id, "position");


--
-- Name: idx_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_task ON public.comments USING btree (task_id, created_at);


--
-- Name: idx_custom_fields_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_fields_project ON public.custom_field_definitions USING btree (project_id, "position");


--
-- Name: idx_jobs_agent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_agent_id ON public.jobs USING btree (agent_id);


--
-- Name: idx_jobs_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_job_id ON public.jobs USING btree (job_id);


--
-- Name: idx_jobs_meeting_booked_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_meeting_booked_at ON public.jobs USING btree (meeting_booked_at) WHERE (meeting_booked_at IS NOT NULL);


--
-- Name: idx_jobs_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_outcome ON public.jobs USING btree (outcome);


--
-- Name: idx_jobs_outcome_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_outcome_at ON public.jobs USING btree (outcome_at) WHERE (outcome_at IS NOT NULL);


--
-- Name: idx_jobs_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_profile_id ON public.jobs USING btree (profile_id);


--
-- Name: idx_jobs_proposal_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_proposal_sent_at ON public.jobs USING btree (proposal_sent_at) WHERE (proposal_sent_at IS NOT NULL);


--
-- Name: idx_jobs_received_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_received_at ON public.jobs USING btree (received_at DESC);


--
-- Name: idx_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_status ON public.jobs USING btree (status);


--
-- Name: idx_jobs_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_task_id ON public.jobs USING btree (task_id);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id, read, created_at DESC);


--
-- Name: idx_saved_views_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_views_project ON public.saved_views USING btree (project_id);


--
-- Name: idx_tasks_column_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_column_position ON public.tasks USING btree (column_id, "position");


--
-- Name: idx_tasks_creator_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_creator_id ON public.tasks USING btree (creator_id);


--
-- Name: idx_tasks_custom_fields; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_custom_fields ON public.tasks USING gin (custom_fields);


--
-- Name: idx_tasks_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (due_date) WHERE (due_date IS NOT NULL);


--
-- Name: idx_tasks_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_project_id ON public.tasks USING btree (project_id);


--
-- Name: idx_webhook_events_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_project ON public.webhook_event_log USING btree (project_id, created_at DESC);


--
-- Name: activity_log trg_activity_log_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_log_append_only BEFORE DELETE OR UPDATE ON public.activity_log FOR EACH ROW EXECUTE FUNCTION public.prevent_activity_log_mutation();


--
-- Name: projects trg_project_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_project_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_task_timestamp();


--
-- Name: columns trg_single_done_column; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_done_column BEFORE INSERT OR UPDATE OF is_done ON public.columns FOR EACH ROW EXECUTE FUNCTION public.enforce_single_done_column();


--
-- Name: tasks trg_task_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_task_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_task_timestamp();


--
-- Name: activity_log activity_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.agents(id);


--
-- Name: activity_log activity_log_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: checklist_items checklist_items_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: columns columns_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.columns
    ADD CONSTRAINT columns_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: comments comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.agents(id);


--
-- Name: comments comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.comments(id) ON DELETE CASCADE;


--
-- Name: comments comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: custom_field_definitions custom_field_definitions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: file_attachments file_attachments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: file_attachments file_attachments_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.agents(id);


--
-- Name: jobs jobs_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: jobs jobs_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(profile_id);


--
-- Name: jobs jobs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: project_members project_members_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects projects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: saved_views saved_views_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.agents(id);


--
-- Name: saved_views saved_views_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: task_assignees task_assignees_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignees
    ADD CONSTRAINT task_assignees_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: task_assignees task_assignees_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignees
    ADD CONSTRAINT task_assignees_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_tag_map task_tag_map_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tag_map
    ADD CONSTRAINT task_tag_map_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.task_tags(id) ON DELETE CASCADE;


--
-- Name: task_tag_map task_tag_map_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tag_map
    ADD CONSTRAINT task_tag_map_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_tags task_tags_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tags
    ADD CONSTRAINT task_tags_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_column_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_column_id_fkey FOREIGN KEY (column_id) REFERENCES public.columns(id);


--
-- Name: tasks tasks_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.agents(id);


--
-- Name: tasks tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: webhook_configs webhook_configs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_configs
    ADD CONSTRAINT webhook_configs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: webhook_event_log webhook_event_log_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_event_log
    ADD CONSTRAINT webhook_event_log_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.agents(id);


--
-- PostgreSQL database dump complete
--

