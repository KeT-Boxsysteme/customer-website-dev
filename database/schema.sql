-- Glovebox-Monitoring by KeT – MSSQL Schema
-- Ausführen gegen die Datenbank, bevor die Anwendung gestartet wird.

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

CREATE TABLE users (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  company_id    INT            NOT NULL REFERENCES companies(id),
  firstname     NVARCHAR(100)  NOT NULL,
  lastname      NVARCHAR(100)  NOT NULL,
  email         NVARCHAR(255)  NOT NULL,
  username      NVARCHAR(4)    NOT NULL,
  department    NVARCHAR(100),
  role          NVARCHAR(20)   NOT NULL CHECK (role IN ('admin','controller','user','box_user')),
  password_hash NVARCHAR(255)  NOT NULL,
  is_active     BIT            NOT NULL DEFAULT 1,
  created_at    DATETIME2      NOT NULL DEFAULT GETDATE(),
  CONSTRAINT uq_user_email UNIQUE (email)
);

CREATE TABLE boxes (
  id                          INT IDENTITY(1,1) PRIMARY KEY,
  company_id                  INT            NOT NULL REFERENCES companies(id),
  manufacturer                NVARCHAR(50)   NOT NULL,
  project_number              NVARCHAR(50)   NOT NULL,
  box_type                    NVARCHAR(100),
  box_alias                   NVARCHAR(100),
  has_dual_filter             BIT            NOT NULL DEFAULT 0,
  has_solvent_filter          BIT            NOT NULL DEFAULT 0,
  solvent_filter_type         NVARCHAR(20),   -- 'charcoal' | 'molecular_sieve'
  charcoal_cycle_months       INT,
  molecular_sieve_cycle_months INT,
  has_solvent_sensor          BIT            NOT NULL DEFAULT 0,
  solvent_sensor_calibrated   NVARCHAR(4),
  has_o2_sensor               BIT            NOT NULL DEFAULT 0,
  o2_sensor_calibrated        NVARCHAR(4),
  has_h2o_sensor              BIT            NOT NULL DEFAULT 0,
  h2o_sensor_calibrated       NVARCHAR(4),
  last_cleaned                DATE,
  has_fridge                  BIT            NOT NULL DEFAULT 0,
  fridge_temp                 INT,
  has_oil_pump                BIT            NOT NULL DEFAULT 0,
  last_oil_change             DATE,
  glove_ports                 INT            NOT NULL DEFAULT 4,
  usage_type                  NVARCHAR(20),   -- 'underpressure' | 'overpressure'
  build_year                  INT,
  additional_notes            NVARCHAR(MAX),
  is_active                   BIT            NOT NULL DEFAULT 1,
  -- Maintenance tracking dates (reset when user clicks "Done")
  last_h2o_cleaning           DATETIME2      NOT NULL DEFAULT GETDATE(),
  last_charcoal_done          DATETIME2      NOT NULL DEFAULT GETDATE(),
  last_sieve_done             DATETIME2      NOT NULL DEFAULT GETDATE(),
  last_solvent_test           DATETIME2      NOT NULL DEFAULT GETDATE(),
  last_oil_done               DATETIME2      NOT NULL DEFAULT GETDATE(),
  -- Cumulative operating hours counter for H2O sensor cleaning (every 2000h)
  operating_hours             INT            NOT NULL DEFAULT 0,
  created_at                  DATETIME2      NOT NULL DEFAULT GETDATE(),
  CONSTRAINT uq_box_project_number UNIQUE (company_id, project_number)
);

CREATE TABLE measurements (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  box_id       INT             NOT NULL REFERENCES boxes(id),
  user_id      INT             REFERENCES users(id),
  o2_value     DECIMAL(10,2),
  h2o_value    DECIMAL(10,2),
  fridge_temp  DECIMAL(10,2),
  measured_at  DATETIME2       NOT NULL DEFAULT GETDATE()
);

-- Indexes for common queries
CREATE INDEX idx_measurements_box_date ON measurements (box_id, measured_at DESC);
CREATE INDEX idx_users_company         ON users (company_id);
CREATE INDEX idx_boxes_company         ON boxes (company_id);
