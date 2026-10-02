-- Glovebox-Monitoring by KeT – MSSQL Schema
-- Idempotent: kann wiederholt ausgeführt werden.

IF OBJECT_ID('dbo.companies', 'U') IS NULL
  CREATE TABLE companies (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    name         NVARCHAR(200)  NOT NULL,
    type         NVARCHAR(20)   NOT NULL CHECK (type IN ('university','startup','company')),
    city         NVARCHAR(100)  NOT NULL,
    street       NVARCHAR(150)  NOT NULL,
    housenumber  NVARCHAR(20)   NOT NULL,
    zip          NVARCHAR(20)   NOT NULL,
    created_at   DATETIME2      NOT NULL DEFAULT GETDATE()
  );

IF OBJECT_ID('dbo.users', 'U') IS NULL
  CREATE TABLE users (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    company_id    INT            NOT NULL REFERENCES companies(id),
    firstname     NVARCHAR(100)  NOT NULL,
    lastname      NVARCHAR(100)  NOT NULL,
    email         NVARCHAR(255)  NOT NULL,
    phone         NVARCHAR(50),
    username      NVARCHAR(4)    NOT NULL,
    department    NVARCHAR(100),
    role          NVARCHAR(20)   NOT NULL CHECK (role IN ('admin','controller','user','box_user')),
    password_hash NVARCHAR(255)  NOT NULL,
    is_active     BIT            NOT NULL DEFAULT 1,
    created_at    DATETIME2      NOT NULL DEFAULT GETDATE(),
    CONSTRAINT uq_user_email UNIQUE (email)
  );

IF OBJECT_ID('dbo.boxes', 'U') IS NULL
  CREATE TABLE boxes (
    id                           INT IDENTITY(1,1) PRIMARY KEY,
    company_id                   INT            NOT NULL REFERENCES companies(id),
    manufacturer                 NVARCHAR(50)   NOT NULL,
    project_number               NVARCHAR(50)   NOT NULL,
    box_type                     NVARCHAR(100),
    box_alias                    NVARCHAR(100),
    has_dual_filter              BIT            NOT NULL DEFAULT 0,
    has_solvent_filter           BIT            NOT NULL DEFAULT 0,
    solvent_filter_type          NVARCHAR(20),
    charcoal_cycle_months        INT,
    molecular_sieve_cycle_months INT,
    lmf_replacement_months       INT,
    has_solvent_sensor           BIT            NOT NULL DEFAULT 0,
    solvent_sensor_calibrated    NVARCHAR(4),
    has_o2_sensor                BIT            NOT NULL DEFAULT 0,
    o2_sensor_calibrated         NVARCHAR(4),
    has_h2o_sensor               BIT            NOT NULL DEFAULT 0,
    h2o_sensor_calibrated        NVARCHAR(4),
    has_pressure_sensor          BIT            NOT NULL DEFAULT 0,
    last_cleaned                 DATE,
    has_fridge                   BIT            NOT NULL DEFAULT 0,
    fridge_temp                  INT,
    has_oil_pump                 BIT            NOT NULL DEFAULT 0,
    last_oil_change              DATE,
    glove_ports                  INT            NOT NULL DEFAULT 4,
    usage_type                   NVARCHAR(20),
    build_year                   INT,
    additional_notes             NVARCHAR(MAX),
    is_active                    BIT            NOT NULL DEFAULT 1,
    last_h2o_cleaning            DATETIME2      NOT NULL DEFAULT GETDATE(),
    last_charcoal_done           DATETIME2      NOT NULL DEFAULT GETDATE(),
    last_sieve_done              DATETIME2      NOT NULL DEFAULT GETDATE(),
    last_solvent_test            DATETIME2      NOT NULL DEFAULT GETDATE(),
    last_oil_done                DATETIME2      NOT NULL DEFAULT GETDATE(),
    last_lmf_replacement         DATETIME2      NOT NULL DEFAULT GETDATE(),
    operating_hours              INT            NOT NULL DEFAULT 0,   -- UNBENUTZT: Betriebsstunden = Echtzeit (E-02), bleibt bewusst stehen (Betreiber 01.10.2026)
    created_at                   DATETIME2      NOT NULL DEFAULT GETDATE(),
    CONSTRAINT uq_box_project_number UNIQUE (company_id, project_number)
  );

IF OBJECT_ID('dbo.measurements', 'U') IS NULL
  CREATE TABLE measurements (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    box_id       INT             NOT NULL REFERENCES boxes(id),
    user_id      INT             REFERENCES users(id),
    o2_value     DECIMAL(10,2),
    h2o_value    DECIMAL(10,2),
    fridge_temp     DECIMAL(10,2),
    pressure_value  DECIMAL(10,3),
    measured_at  DATETIME2       NOT NULL DEFAULT GETDATE()
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_measurements_box_date' AND object_id = OBJECT_ID('dbo.measurements'))
  CREATE INDEX idx_measurements_box_date ON measurements (box_id, measured_at DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_users_company' AND object_id = OBJECT_ID('dbo.users'))
  CREATE INDEX idx_users_company ON users (company_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_boxes_company' AND object_id = OBJECT_ID('dbo.boxes'))
  CREATE INDEX idx_boxes_company ON boxes (company_id);

-- Bestätigungen ("Erledigt") für ppm-Warnmeldungen des Ampelsystems
IF OBJECT_ID('dbo.alert_acks', 'U') IS NULL
  CREATE TABLE alert_acks (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    box_id     INT           NOT NULL REFERENCES boxes(id),
    alert_key  NVARCHAR(40)  NOT NULL,
    -- GETDATE() wie measurements.measured_at: eine gemeinsame Uhr fuer den Ack-Vergleich in services/alerts.js
    acked_at   DATETIME2     NOT NULL DEFAULT GETDATE(),
    acked_by   INT           NULL REFERENCES users(id)
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_alert_acks_box_key' AND object_id = OBJECT_ID('dbo.alert_acks'))
  CREATE INDEX idx_alert_acks_box_key ON alert_acks (box_id, alert_key);

-- Nachtraegliche Spalten (Bestandsdatenbanken): Druckmessung in bar
IF COL_LENGTH('dbo.boxes', 'has_pressure_sensor') IS NULL
  ALTER TABLE boxes ADD has_pressure_sensor BIT NOT NULL DEFAULT 0;

IF COL_LENGTH('dbo.measurements', 'pressure_value') IS NULL
  ALTER TABLE measurements ADD pressure_value DECIMAL(10,3) NULL;

-- Nachtraegliche Spalten: LMF-Tauscherinnerung (Quartal/Halbjahr/Jahr)
IF COL_LENGTH('dbo.boxes', 'lmf_replacement_months') IS NULL
  ALTER TABLE boxes ADD lmf_replacement_months INT NULL;

IF COL_LENGTH('dbo.boxes', 'last_lmf_replacement') IS NULL
  ALTER TABLE boxes ADD last_lmf_replacement DATETIME2 NOT NULL DEFAULT GETDATE();

-- Nachtraegliche Spalte: Bluetooth-Temperaturfuehler je Box (Seriennummer, 6 Hex-Zeichen)
IF COL_LENGTH('dbo.boxes', 'sensor_serial') IS NULL
  ALTER TABLE boxes ADD sensor_serial NVARCHAR(6) NULL;

-- Ein Fuehler haengt je Firma an hoechstens einer Box (E-17) - Riegel auch in der Datenbank
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_boxes_company_sensor' AND object_id = OBJECT_ID('dbo.boxes'))
  CREATE UNIQUE INDEX ux_boxes_company_sensor ON boxes (company_id, sensor_serial) WHERE sensor_serial IS NOT NULL;

-- Nachtraegliche Spalte: Speichertakt des Fuehlers in Minuten (1/5/10/15/30/60, NULL = Vorgabe 1) - E-19
IF COL_LENGTH('dbo.boxes', 'sensor_store_minutes') IS NULL
  ALTER TABLE boxes ADD sensor_store_minutes INT NULL;

-- Nachtraegliche Spalten: Kuehlschrank-Alarm bleibt bis "Done" (Betreiber 01.10.2026). Geschrieben nur bei
-- neuem Alarm oder Eskalation gelb -> rot (models/box.js escalateFridgeAlarm), geleert von "Done".
IF COL_LENGTH('dbo.boxes', 'fridge_alarm_level') IS NULL
  ALTER TABLE boxes ADD fridge_alarm_level NVARCHAR(10) NULL
    CONSTRAINT ck_boxes_fridge_alarm_level CHECK (fridge_alarm_level IN ('yellow','red'));

IF COL_LENGTH('dbo.boxes', 'fridge_alarm_since') IS NULL
  ALTER TABLE boxes ADD fridge_alarm_since DATETIME2 NULL;

IF COL_LENGTH('dbo.boxes', 'fridge_alarm_temp') IS NULL
  ALTER TABLE boxes ADD fridge_alarm_temp FLOAT NULL;

IF COL_LENGTH('dbo.boxes', 'fridge_alarm_source') IS NULL
  ALTER TABLE boxes ADD fridge_alarm_source NVARCHAR(10) NULL
    CONSTRAINT ck_boxes_fridge_alarm_source CHECK (fridge_alarm_source IN ('sensor','manual'));

-- Nachtraegliche Spalten: zweiter Fuehler je Box fuer die Boxtemperatur, reine Info (E-34, Betreiber 02.10.2026)
IF COL_LENGTH('dbo.boxes', 'box_sensor_serial') IS NULL
  ALTER TABLE boxes ADD box_sensor_serial NVARCHAR(6) NULL;

IF COL_LENGTH('dbo.boxes', 'box_sensor_store_minutes') IS NULL
  ALTER TABLE boxes ADD box_sensor_store_minutes INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_boxes_company_box_sensor' AND object_id = OBJECT_ID('dbo.boxes'))
  CREATE UNIQUE INDEX ux_boxes_company_box_sensor ON boxes (company_id, box_sensor_serial) WHERE box_sensor_serial IS NOT NULL;

-- Verlauf der Live-Werte vom Bluetooth-Fuehler (Paket 2). Getrennt von measurements, weil dort
-- Eingaben von Personen (Kuerzel) stehen und die Ampel daran haengt.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sensor_readings')
  CREATE TABLE sensor_readings (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    box_id        INT            NOT NULL REFERENCES boxes(id),
    sensor_serial NVARCHAR(6)    NOT NULL,
    temp          DECIMAL(6,1)   NOT NULL,
    measured_at   DATETIME2      NOT NULL DEFAULT GETDATE()
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_sensor_readings_box_time' AND object_id = OBJECT_ID('dbo.sensor_readings'))
  CREATE INDEX idx_sensor_readings_box_time ON sensor_readings (box_id, measured_at);

-- Art des Fuehlers je Wert (E-34): 'fridge' (alle bisherigen Werte) oder 'box' (Boxtemperatur, reine Info)
IF COL_LENGTH('dbo.sensor_readings', 'kind') IS NULL
  ALTER TABLE sensor_readings ADD kind NVARCHAR(10) NOT NULL CONSTRAINT df_sensor_readings_kind DEFAULT 'fridge'
    CONSTRAINT ck_sensor_readings_kind CHECK (kind IN ('fridge','box'));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_sensor_readings_box_kind_time' AND object_id = OBJECT_ID('dbo.sensor_readings'))
  CREATE INDEX idx_sensor_readings_box_kind_time ON sensor_readings (box_id, kind, measured_at);

-- Login-Sitzungen (Betreiber 01.10.): ueberleben Deploys/Neustarts. Nur services/sessionStore.js liest/schreibt.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sessions')
  CREATE TABLE sessions (
    sid      NVARCHAR(255)  NOT NULL PRIMARY KEY,
    session  NVARCHAR(MAX)  NOT NULL,
    expires  DATETIME2      NOT NULL
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_sessions_expires' AND object_id = OBJECT_ID('dbo.sessions'))
  CREATE INDEX idx_sessions_expires ON sessions (expires);

-- Freischaltung + Nutz-Nummer (KETAUFTRAG_Website-Freischaltung.txt, Abschnitt 4, abgestimmt mit KET 2026-10-01).
-- Neue Einrichtungen warten auf Freischaltung (pending). KET schreibt status/access_code/approved_*/plan/ket_kunde_id.
IF COL_LENGTH('dbo.companies', 'status') IS NULL
  ALTER TABLE companies ADD status NVARCHAR(20) NOT NULL CONSTRAINT df_companies_status DEFAULT 'pending'
    CONSTRAINT ck_companies_status CHECK (status IN ('pending','active','suspended','rejected'));

IF COL_LENGTH('dbo.companies', 'access_code') IS NULL
  ALTER TABLE companies ADD access_code CHAR(6) NULL
    CONSTRAINT ck_companies_access_code CHECK (access_code LIKE '[1-9][0-9][0-9][0-9][0-9][0-9]');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_companies_access_code' AND object_id = OBJECT_ID('dbo.companies'))
  CREATE UNIQUE INDEX ux_companies_access_code ON companies (access_code) WHERE access_code IS NOT NULL;

IF COL_LENGTH('dbo.companies', 'approved_at') IS NULL
  ALTER TABLE companies ADD approved_at DATETIME2 NULL;

IF COL_LENGTH('dbo.companies', 'approved_by') IS NULL
  ALTER TABLE companies ADD approved_by NVARCHAR(100) NULL;

IF COL_LENGTH('dbo.companies', 'plan') IS NULL
  ALTER TABLE companies ADD [plan] NVARCHAR(20) NULL CONSTRAINT ck_companies_plan CHECK ([plan] IN ('free','premium'));

IF COL_LENGTH('dbo.companies', 'ket_kunde_id') IS NULL
  ALTER TABLE companies ADD ket_kunde_id INT NULL;

-- Website-intern: fuer welche Nummer die Mail an die Einrichtung schon raus ist (Wiederholung ohne doppelte Mail)
IF COL_LENGTH('dbo.companies', 'notified_code') IS NULL
  ALTER TABLE companies ADD notified_code CHAR(6) NULL;

-- Rolle service (7.10): internen KeT-Benutzer erlauben. Alte, unbenannte CHECK-Regel durch eine benannte ersetzen.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_users_role' AND parent_object_id = OBJECT_ID('dbo.users'))
BEGIN
  DECLARE @old SYSNAME = (SELECT TOP 1 name FROM sys.check_constraints
                          WHERE parent_object_id = OBJECT_ID('dbo.users') AND definition LIKE '%box_user%')
  IF @old IS NOT NULL EXEC('ALTER TABLE users DROP CONSTRAINT [' + @old + ']')
  ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role IN ('admin','controller','user','box_user','service'))
END;

-- Passwort-Reset-Links (Fund 01.10.: lagen im Arbeitsspeicher, jeder Deploy machte sie ungueltig).
-- Nur der SHA-256-Hash des Links; einmal einloesbar (used_at). Nur models/passwordReset.js liest/schreibt.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'password_resets')
  CREATE TABLE password_resets (
    token_hash  CHAR(64)   NOT NULL PRIMARY KEY,
    user_id     INT        NOT NULL REFERENCES users(id),
    expires_at  DATETIME2  NOT NULL,
    used_at     DATETIME2  NULL,
    created_at  DATETIME2  NOT NULL DEFAULT SYSUTCDATETIME()
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_password_resets_user' AND object_id = OBJECT_ID('dbo.password_resets'))
  CREATE INDEX idx_password_resets_user ON password_resets (user_id, used_at);
