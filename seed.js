/* ==========================================================
   ScriptBase | seed.js
   Scripts FICTÍCIOS do modo visitante. Tabelas, colunas e
   regras são inventadas e genéricas: nada aqui vem de
   cliente ou sistema real. Pode ser público no GitHub.
   ========================================================== */
(() => {
    'use strict';

    // Datas relativas para a demo sempre parecer recente
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

    window.DEMO_SCRIPTS = [
        {
            id: 'demo-001',
            title: 'Recriar view de produtos fiscais (coluna desconhecida)',
            errorText: '[FireDAC][Phys][FB] Dynamic SQL Error\nSQL error code = -206\nColumn unknown\nCFOP_SAIDA',
            description: 'O relatório fiscal quebra com "Column unknown" depois que uma coluna nova é criada na tabela de produtos. Recria a view incluindo a coluna.',
            code: `ALTER VIEW VW_PRODUTOS_FISCAL (ID, NOME, NCM, CFOP_SAIDA) AS
SELECT P.ID, P.NOME, P.NCM, P.CFOP_SAIDA
  FROM PRODUTOS P
 WHERE P.ATIVO = 1;`,
            tags: ['Fiscal', 'Banco de Dados'],
            favorite: true,
            useCount: 14,
            createdAt: daysAgo(40),
            updatedAt: daysAgo(3),
            logs: [{ date: daysAgo(40), msg: 'Script criado' }, { date: daysAgo(3), msg: 'Editado: incluída a coluna NCM' }]
        },
        {
            id: 'demo-002',
            title: 'Padronizar CFOP de saída por grupo de produtos',
            errorText: '',
            description: 'Atualiza o CFOP de saída de todos os produtos de um grupo, apenas onde está diferente do valor desejado.',
            code: `-- Troque as variáveis antes de rodar
UPDATE PRODUTOS
   SET CFOP_SAIDA = @CFOP_NOVO
 WHERE ID_EMPRESA = @ID_EMPRESA
   AND ID_GRUPO   = @ID_GRUPO
   AND CFOP_SAIDA <> @CFOP_NOVO;`,
            tags: ['Fiscal'],
            favorite: false,
            useCount: 9,
            createdAt: daysAgo(35),
            updatedAt: daysAgo(35),
            logs: [{ date: daysAgo(35), msg: 'Script criado' }]
        },
        {
            id: 'demo-003',
            title: 'NFC-e travada em "Processando": voltar para reenvio',
            errorText: 'NFC-e com status Processando há mais de 30 minutos, sem protocolo de autorização.',
            description: 'Quando a nota fica presa sem retorno da SEFAZ, volta o status para pendente e a rotina de envio tenta de novo. Confirme antes que a nota não foi autorizada.',
            code: `UPDATE NOTAS_FISCAIS
   SET STATUS = 'PENDENTE'
 WHERE ID = @ID_NOTA
   AND STATUS = 'PROCESSANDO';`,
            tags: ['NFe/NFCe', 'Fiscal'],
            favorite: true,
            useCount: 21,
            createdAt: daysAgo(30),
            updatedAt: daysAgo(10),
            logs: [{ date: daysAgo(30), msg: 'Script criado' }, { date: daysAgo(10), msg: 'Editado: adicionado filtro de status' }]
        },
        {
            id: 'demo-004',
            title: 'Notas autorizadas sem protocolo no período',
            errorText: 'Nota consta como autorizada, mas o XML não tem número de protocolo.',
            description: 'Lista as notas marcadas como autorizadas que estão sem protocolo, para conferir uma a uma antes de qualquer correção.',
            code: `SELECT N.ID, N.NUMERO, N.SERIE, N.DATA_EMISSAO, N.STATUS
  FROM NOTAS_FISCAIS N
 WHERE N.STATUS = 'AUTORIZADA'
   AND (N.PROTOCOLO IS NULL OR N.PROTOCOLO = '')
   AND N.DATA_EMISSAO BETWEEN {DATA_INICIO} AND {DATA_FIM}
 ORDER BY N.DATA_EMISSAO;`,
            tags: ['NFe/NFCe'],
            favorite: false,
            useCount: 6,
            createdAt: daysAgo(28),
            updatedAt: daysAgo(28),
            logs: [{ date: daysAgo(28), msg: 'Script criado' }]
        },
        {
            id: 'demo-005',
            title: 'Produtos com estoque negativo',
            errorText: 'Cliente reclama que o estoque aparece negativo no relatório de inventário.',
            description: 'Consulta os produtos com saldo menor que zero em uma empresa, do pior para o menos grave.',
            code: `SELECT P.ID, P.NOME, E.SALDO
  FROM ESTOQUE E
  JOIN PRODUTOS P ON P.ID = E.ID_PRODUTO
 WHERE E.SALDO < 0
   AND E.ID_EMPRESA = @ID_EMPRESA
 ORDER BY E.SALDO;`,
            tags: ['Estoque'],
            favorite: false,
            useCount: 11,
            createdAt: daysAgo(25),
            updatedAt: daysAgo(25),
            logs: [{ date: daysAgo(25), msg: 'Script criado' }]
        },
        {
            id: 'demo-006',
            title: 'Zerar saldo negativo de estoque (ajuste)',
            errorText: '',
            description: 'Usar só depois de lançar o movimento de ajuste e alinhar com o cliente. Zera apenas os saldos negativos da empresa informada.',
            code: `UPDATE ESTOQUE
   SET SALDO = 0
 WHERE SALDO < 0
   AND ID_EMPRESA = @ID_EMPRESA;`,
            tags: ['Estoque'],
            favorite: false,
            useCount: 3,
            createdAt: daysAgo(24),
            updatedAt: daysAgo(12),
            logs: [{ date: daysAgo(24), msg: 'Script criado' }, { date: daysAgo(12), msg: 'Editado: incluído filtro por empresa' }]
        },
        {
            id: 'demo-007',
            title: 'Títulos vencidos em aberto por cliente',
            errorText: '',
            description: 'Relatório rápido de contas a receber vencidas e ainda abertas, ordenado pelo vencimento mais antigo.',
            code: `SELECT C.NOME, T.NUMERO_DOC, T.VENCIMENTO, T.VALOR
  FROM TITULOS_RECEBER T
  JOIN CLIENTES C ON C.ID = T.ID_CLIENTE
 WHERE T.STATUS = 'ABERTO'
   AND T.VENCIMENTO < CURRENT_DATE
 ORDER BY T.VENCIMENTO;`,
            tags: ['Financeiro', 'Vendas'],
            favorite: false,
            useCount: 8,
            createdAt: daysAgo(20),
            updatedAt: daysAgo(20),
            logs: [{ date: daysAgo(20), msg: 'Script criado' }]
        },
        {
            id: 'demo-008',
            title: 'Clientes duplicados por CPF/CNPJ',
            errorText: 'violation of PRIMARY or UNIQUE KEY constraint "UQ_CLIENTES_DOC"',
            description: 'Encontra documentos que aparecem em mais de um cadastro, antes de aplicar uma restrição de unicidade ou unificar clientes.',
            code: `SELECT DOCUMENTO, COUNT(*) AS QTD
  FROM CLIENTES
 WHERE DOCUMENTO IS NOT NULL
 GROUP BY DOCUMENTO
HAVING COUNT(*) > 1
 ORDER BY QTD DESC;`,
            tags: ['Vendas', 'Geral'],
            favorite: false,
            useCount: 5,
            createdAt: daysAgo(15),
            updatedAt: daysAgo(15),
            logs: [{ date: daysAgo(15), msg: 'Script criado' }]
        },
        {
            id: 'demo-009',
            title: 'Listar e reativar índices inativos (Firebird)',
            errorText: 'Lentidão em consultas após restauração de backup. Índices aparecem como inativos.',
            description: 'Primeiro lista os índices inativos de tabelas do usuário. Depois reativa um índice específico informando o nome.',
            code: `-- 1) Listar índices inativos
SELECT RDB$RELATION_NAME, RDB$INDEX_NAME
  FROM RDB$INDICES
 WHERE RDB$INDEX_INACTIVE = 1
   AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0;

-- 2) Reativar um índice
ALTER INDEX {NOME_INDICE} ACTIVE;`,
            tags: ['Banco de Dados'],
            favorite: false,
            useCount: 4,
            createdAt: daysAgo(8),
            updatedAt: daysAgo(8),
            logs: [{ date: daysAgo(8), msg: 'Script criado' }]
        }
    ];
})();
