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
    has_solvent_sensor           BIT            NOT NULL DEFAULT 0,
    solvent_sensor_calibrated    NVARCHAR(4),
    has_o2_sensor                BIT            NOT NULL DEFAULT 0,
    o2_sensor_calibrated         NVARCHAR(4),
    has_h2o_sensor               BIT            NOT NULL DEFAULT 0,
    h2o_sensor_calibrated        NVARCHAR(4),
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
    operating_hours              INT            NOT NULL DEFAULT 0,
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
    fridge_temp  DECIMAL(10,2),
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
