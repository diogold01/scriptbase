/* ==========================================================
   ScriptBase | storage.js
   Camada de dados, autenticação e equipe.
   A interface (app.js) só conversa com ScriptStore, Auth e Team.
   Suporta modo visitante (localStorage) e modo sincronizado
   com Supabase (biblioteca pessoal ou biblioteca de equipe).
   ========================================================== */
(() => {
    'use strict';

    // Valores públicos vindos de config.js (URL + chave publicável)
    const CONFIG = window.SCRIPTBASE_CONFIG || {};

    // Client do Supabase criado uma única vez, sob demanda
    let sbClient = null;
    function getClient() {
        if (!sbClient) {
            sbClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
                auth: { persistSession: true, autoRefreshToken: true }
            });
        }
        return sbClient;
    }

    const KEYS = { visitor: 'scriptbase_visitor_v1' };
    const MAX_LOGS = 50;

    /* ---------- utilitários ---------- */
    function newId() {
        if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    const str = (v) => (typeof v === 'string' ? v : '');

    // Aceita ISO, "dd/mm/aaaa [hh:mm[:ss]]" (formato do ScriptBase antigo) e timestamp numérico
    function toISO(v) {
        if (v === null || v === undefined || v === '') return null;
        if (typeof v === 'number') {
            const d = new Date(v);
            return isNaN(d) ? null : d.toISOString();
        }
        if (typeof v !== 'string') return null;
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
            const d = new Date(v);
            return isNaN(d) ? null : d.toISOString();
        }
        const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) {
            const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
            return isNaN(d) ? null : d.toISOString();
        }
        return null;
    }

    // Só aceita imagem embutida (data URL): evita URL externa vinda de JSON importado
    const IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

    function normalize(raw) {
        const r = raw && typeof raw === 'object' ? raw : {};
        const id = r.id !== undefined && r.id !== null && String(r.id) !== '' ? String(r.id) : newId();
        const idNum = Number(id);
        const now = new Date().toISOString();

        const created =
            toISO(r.createdAt) ||
            (idNum > 1e12 && idNum < 4e12 ? new Date(idNum).toISOString() : null) || // ids antigos eram Date.now()
            toISO(r.updatedAt) ||
            now;
        const updated = toISO(r.updatedAt) || created;

        const tags = [];
        (Array.isArray(r.tags) ? r.tags : []).forEach((t) => {
            const tag = str(t).trim().slice(0, 30);
            if (tag && !tags.some((x) => x.toLowerCase() === tag.toLowerCase())) tags.push(tag);
        });

        const logs = (Array.isArray(r.logs) ? r.logs : [])
            .map((l) => ({ date: toISO(l && l.date) || updated, msg: str(l && l.msg).slice(0, 300) }))
            .filter((l) => l.msg)
            .slice(-MAX_LOGS);

        const useCount = Math.max(0, parseInt(r.useCount, 10) || 0);
        const image = IMAGE_RE.test(str(r.image)) ? r.image : '';

        return {
            id,
            title: str(r.title).trim().slice(0, 150),
            errorText: str(r.errorText),
            description: str(r.description),
            code: str(r.code),
            tags: tags.slice(0, 12),
            favorite: !!r.favorite,
            useCount,
            image,
            logs,
            createdAt: created,
            updatedAt: updated
        };
    }

    /* ---------- adaptador local (localStorage) ---------- */
    function createLocalAdapter(key, seedFn) {
        function read() {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) return null;
                const arr = JSON.parse(raw);
                return Array.isArray(arr) ? arr.map(normalize) : null;
            } catch (_) {
                return null;
            }
        }

        function write(list) {
            try {
                localStorage.setItem(key, JSON.stringify(list));
            } catch (_) {
                throw new Error('Armazenamento do navegador cheio. Remova imagens grandes ou exporte um backup.');
            }
        }

        return {
            async init() {
                if (read() === null) write(seedFn ? seedFn() : []);
            },
            async list() {
                return read() || [];
            },
            async save(script, authorEmail) {
                const list = read() || [];
                const item = normalize(script);
                if (authorEmail) {
                    const now = new Date().toISOString();
                    const isNew = !list.some((x) => x.id === item.id);
                    const msg = `${isNew ? 'Criado por' : 'Editado por'} ${authorEmail}`;
                    const last = item.logs[item.logs.length - 1];
                    if (!last || last.msg !== msg) {
                        item.logs = [...item.logs, { date: now, msg }].slice(-MAX_LOGS);
                    }
                }
                const i = list.findIndex((x) => x.id === item.id);
                if (i >= 0) list[i] = item;
                else list.push(item);
                write(list);
                return item;
            },
            async upsertMany(items) {
                const list = read() || [];
                items.map(normalize).forEach((item) => {
                    const i = list.findIndex((x) => x.id === item.id);
                    if (i >= 0) list[i] = item;
                    else list.push(item);
                });
                write(list);
            },
            async remove(id) {
                write((read() || []).filter((x) => x.id !== id));
            },
            async incrementUse(id) {
                const list = read() || [];
                const item = list.find((x) => x.id === id);
                if (!item) return null;
                item.useCount += 1; // não altera updatedAt
                write(list);
                return item;
            },
            async reset() {
                write(seedFn ? seedFn() : []);
            }
        };
    }

    const demoSeed = () => (window.DEMO_SCRIPTS || []).map(normalize);
    const visitorAdapter = createLocalAdapter(KEYS.visitor, demoSeed);

    /* ---------- adaptador do Supabase (modo autenticado: pessoal ou equipe) ---------- */
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const BATCH_SIZE = 50;

    let currentUser = null;
    let activeWorkspace = null; // null = pessoal; { ownerId, ownerEmail, teamId, role } = equipe

    function fail(error, msg) {
        console.error('[ScriptBase] Supabase:', error);
        return new Error(msg);
    }

    function fromRow(row) {
        return normalize({
            id: row.id,
            title: row.title,
            errorText: row.error_text,
            description: row.description,
            code: row.code,
            tags: row.tags,
            favorite: row.favorite,
            useCount: row.use_count,
            image: row.image,
            logs: row.logs,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }

    // Se houver um dono de equipe definido, grava com o ID do dono.
    // Caso contrário, deixa o banco preencher com auth.uid().
    function toRow(script, targetUserId) {
        const s = normalize(script);
        const row = {
            id: UUID_RE.test(s.id) ? s.id : newId(),
            title: s.title,
            error_text: s.errorText,
            description: s.description,
            code: s.code,
            tags: s.tags,
            favorite: s.favorite,
            use_count: s.useCount,
            image: s.image,
            logs: s.logs,
            created_at: s.createdAt,
            updated_at: s.updatedAt
        };
        if (targetUserId) {
            row.user_id = targetUserId;
        }
        return row;
    }

    function createSupabaseAdapter() {
        const table = () => getClient().from('scripts');

        return {
            async init() {},
            async list() {
                let query = table().select('*');
                if (activeWorkspace && activeWorkspace.ownerId) {
                    query = query.eq('user_id', activeWorkspace.ownerId);
                } else if (currentUser && currentUser.id) {
                    query = query.eq('user_id', currentUser.id);
                }
                const { data, error } = await query.order('updated_at', { ascending: false });
                if (error) throw fail(error, 'Não foi possível carregar os scripts.');
                return (data || []).map(fromRow);
            },
            async save(script, authorEmail) {
                const s = normalize(script);
                const email = authorEmail || (currentUser && currentUser.email) || '';
                if (email) {
                    const now = new Date().toISOString();
                    const isNew = !s.logs.length && (!s.createdAt || s.createdAt === s.updatedAt);
                    const msg = `${isNew ? 'Criado por' : 'Editado por'} ${email}`;
                    const last = s.logs[s.logs.length - 1];
                    if (!last || last.msg !== msg) {
                        s.logs = [...s.logs, { date: now, msg }].slice(-MAX_LOGS);
                    }
                }
                const targetUserId = (activeWorkspace && activeWorkspace.ownerId) || (currentUser && currentUser.id) || null;
                const row = toRow(s, targetUserId);
                const { data, error } = await table()
                    .upsert(row, { onConflict: 'id' })
                    .select()
                    .single();
                if (error) throw fail(error, 'Não foi possível salvar o script.');
                return fromRow(data);
            },
            async upsertMany(items) {
                const targetUserId = (activeWorkspace && activeWorkspace.ownerId) || (currentUser && currentUser.id) || null;
                const rows = items.map((x) => toRow(x, targetUserId));
                for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                    const { error } = await table().upsert(rows.slice(i, i + BATCH_SIZE), { onConflict: 'id' });
                    if (error) throw fail(error, 'Não foi possível importar os scripts.');
                }
            },
            async remove(id) {
                const { error } = await table().delete().eq('id', id);
                if (error) throw fail(error, 'Não foi possível excluir o script.');
            },
            async incrementUse(id) {
                const { data, error } = await getClient().rpc('increment_script_use', { p_id: id });
                if (error) throw fail(error, 'Não foi possível atualizar o contador.');
                const row = Array.isArray(data) ? data[0] : data;
                return row && row.id ? fromRow(row) : null;
            }
        };
    }

    const ownerAdapter = createSupabaseAdapter();

    /* ---------- ScriptStore (API usada pela interface) ---------- */
    let adapter = null;
    let currentMode = null;

    const ensure = () => {
        if (!adapter) throw new Error('Sessão não iniciada.');
        return adapter;
    };

    window.ScriptStore = {
        normalize,
        newId,
        get mode() { return currentMode; },
        get currentUser() { return currentUser; },
        get activeWorkspace() { return activeWorkspace; },

        setActiveWorkspace(ws) {
            activeWorkspace = ws || null;
        },

        async init(mode, workspace = null) {
            if (mode === 'visitor') {
                adapter = visitorAdapter;
                currentUser = null;
                activeWorkspace = null;
            } else if (mode === 'owner') {
                if (!window.Auth.isConfigured()) throw new Error('A conexão com o banco precisa estar configurada.');
                let session = null;
                try {
                    const res = await getClient().auth.getSession();
                    session = res.data && res.data.session;
                } catch (e) {
                    throw fail(e, 'Não foi possível conectar ao Supabase.');
                }
                if (!session) throw new Error('Sessão expirada. Entre novamente.');
                currentUser = {
                    id: session.user.id,
                    email: session.user.email || ''
                };
                activeWorkspace = workspace;
                adapter = ownerAdapter;
            } else {
                throw new Error('Modo de acesso inválido.');
            }
            await adapter.init();
            currentMode = mode;
        },

        list: () => ensure().list(),
        save: (script, authorEmail) => ensure().save(script, authorEmail),
        upsertMany: (items) => ensure().upsertMany(items),
        remove: (id) => ensure().remove(id),
        incrementUse: (id) => ensure().incrementUse(id),
        resetDemo: () => (currentMode === 'visitor' ? visitorAdapter.reset() : Promise.resolve())
    };

    /* ---------- Auth (Supabase) ---------- */
    window.Auth = {
        isConfigured() {
            return !!(
                CONFIG.SUPABASE_URL &&
                CONFIG.SUPABASE_PUBLISHABLE_KEY &&
                window.supabase &&
                typeof window.supabase.createClient === 'function'
            );
        },
        async restore() {
            if (!this.isConfigured()) return null;
            try {
                const { data } = await getClient().auth.getSession();
                if (data && data.session) {
                    currentUser = {
                        id: data.session.user.id,
                        email: data.session.user.email || ''
                    };
                    return 'owner';
                }
                return null;
            } catch (e) {
                console.error('[ScriptBase] Supabase:', e);
                return null;
            }
        },
        async getUser() {
            if (!this.isConfigured()) return null;
            try {
                const { data } = await getClient().auth.getUser();
                return (data && data.user) || null;
            } catch (e) {
                console.error('[ScriptBase] Supabase:', e);
                return null;
            }
        },
        async signIn(email, password) {
            if (!this.isConfigured()) {
                throw new Error('Serviço de autenticação ainda não configurado.');
            }
            let result;
            try {
                result = await getClient().auth.signInWithPassword({ email, password });
            } catch (e) {
                throw fail(e, 'Não foi possível conectar ao Supabase.');
            }
            if (result.error) {
                const err = result.error;
                const network = /fetch|network/i.test(err.name + ' ' + err.message) && !err.status;
                if (network || err.status === 0 || err.status >= 500) {
                    throw fail(err, 'Não foi possível conectar ao Supabase.');
                }
                throw fail(err, 'E-mail ou senha incorretos.');
            }
            if (result.data && result.data.user) {
                currentUser = {
                    id: result.data.user.id,
                    email: result.data.user.email || ''
                };
            }
            return result.data;
        },
        async signUp(email, password) {
            if (!this.isConfigured()) {
                throw new Error('Serviço de autenticação ainda não configurado.');
            }
            let result;
            try {
                result = await getClient().auth.signUp({ email, password });
            } catch (e) {
                throw fail(e, 'Não foi possível conectar ao Supabase.');
            }
            if (result.error) {
                const err = result.error;
                const network = /fetch|network/i.test(err.name + ' ' + err.message) && !err.status;
                if (network || err.status === 0 || err.status >= 500) {
                    throw fail(err, 'Não foi possível conectar ao Supabase.');
                }
                const msg = err.message || '';
                if (/already registered|user already exists/i.test(msg)) {
                    throw fail(err, 'Este e-mail já está cadastrado. Faça login.');
                }
                if (/signups not allowed/i.test(msg)) {
                    throw fail(err, 'Cadastros novos estão desativados no painel do Supabase.');
                }
                if (/password.*least.*characters/i.test(msg)) {
                    throw fail(err, 'A senha deve ter pelo menos 6 caracteres.');
                }
                throw fail(err, msg || 'Não foi possível cadastrar a conta.');
            }
            if (result.data && result.data.user) {
                currentUser = {
                    id: result.data.user.id,
                    email: result.data.user.email || ''
                };
            }
            return result.data;
        },
        async signOut() {
            if (!this.isConfigured()) return;
            try {
                await getClient().auth.signOut();
            } catch (e) {
                console.error('[ScriptBase] Supabase:', e);
            } finally {
                currentUser = null;
                activeWorkspace = null;
            }
        }
    };

    /* ---------- Team (Operações de Equipe e Convites) ---------- */
    window.Team = {
        async getMyTeam() {
            if (!window.Auth.isConfigured()) return null;
            const { data, error } = await getClient().rpc('get_or_create_my_team');
            if (error) throw fail(error, error.message || 'Não foi possível carregar os dados da equipe.');
            return data;
        },
        async regenerateInviteCode() {
            if (!window.Auth.isConfigured()) return null;
            const { data, error } = await getClient().rpc('regenerate_invite_code');
            if (error) throw fail(error, error.message || 'Não foi possível gerar novo link de convite.');
            return data;
        },
        async joinTeam(inviteCode) {
            if (!window.Auth.isConfigured()) throw new Error('Serviço de autenticação não configurado.');
            const { data, error } = await getClient().rpc('join_team', { p_invite_code: inviteCode });
            if (error) {
                const msg = error.message || '';
                if (/inválido|expirado/i.test(msg)) {
                    throw fail(error, 'Convite inválido ou expirado.');
                }
                throw fail(error, msg || 'Não foi possível entrar na equipe.');
            }
            return data;
        },
        async getMembers() {
            if (!window.Auth.isConfigured()) return [];
            const { data, error } = await getClient().rpc('get_team_members');
            if (error) throw fail(error, error.message || 'Não foi possível listar os membros da equipe.');
            return data || [];
        },
        async removeMember(memberId) {
            if (!window.Auth.isConfigured()) return false;
            const { data, error } = await getClient().rpc('remove_team_member', { p_member_id: memberId });
            if (error) throw fail(error, error.message || 'Não foi possível remover o membro da equipe.');
            return data;
        },
        async getMyActiveTeams() {
            if (!window.Auth.isConfigured()) return [];
            const { data, error } = await getClient().rpc('get_my_active_teams');
            if (error) throw fail(error, error.message || 'Não foi possível consultar as equipes.');
            return data || [];
        },
        async leaveTeam(teamId) {
            if (!window.Auth.isConfigured()) return false;
            const { data, error } = await getClient().rpc('leave_team', { p_team_id: teamId });
            if (error) throw fail(error, error.message || 'Não foi possível sair da equipe.');
            return data;
        }
    };
})();
