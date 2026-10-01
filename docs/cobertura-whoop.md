# Cobertura WHOOP Strength Trainer vs base de ejercicios

Fecha: 2026-10-01

## Fuentes (solo públicas, sin scrapear la app)

- **Lista WHOOP**: "Complete WHOOP Exercise List for Easy Reference", publicada por el usuario
  Apu_Spell el 2025-08-09 en el foro oficial de WHOOP (community.whoop.com, tema 6734).
  La lista se usa únicamente como **lista de control de nombres** (hechos no protegidos);
  no se copió ningún texto descriptivo ni medio de WHOOP. Verificación hecha contra el
  post crudo: 286 nombres únicos tras normalizar tipografía del foro (guiones largos,
  apóstrofes tipográficos, el filtro del foro que muestra "Snat(ch)" y un salto de línea
  partido en "...L - D / umbbell").
- El artículo oficial de soporte "List of WHOOP Activities" (support.whoop.com) lista
  actividades/deportes, no movimientos individuales del Strength Trainer, y además no
  cargó su contenido (error de CSS en la página de Salesforce). Artículos públicos de WHOOP
  (thelocker) y prensa (Wareable, the5krunner) describen categorías pero no la lista completa.
- **Base comparada**: `datos/exercises.json` (free-exercise-db, licencia Unlicense),
  876 ejercicios, nombres en inglés. Se usó el fallback porque
  `staging-datos/data/ejercicios.json` no existía tras 5 reintentos de 60 s
  (espera agotada el 2026-10-01).

## Criterio de cobertura

- **Sí** — la base contiene el mismo movimiento con el mismo tipo de implemento.
  Las variantes solo de lado (L/R/alternado) cuentan como Sí contra el ejercicio base.
- **Parcial** — la base cubre el patrón de movimiento, pero no la variante exacta de WHOOP
  (tempo: pausa/concéntrico; postura: de rodillas/sentado; agarre o barra específica;
  implemento distinto, p. ej. mancuerna vs kettlebell).
- **No** — ningún ejercicio equivalente en la base.

Cada emparejamiento se curó a mano contra el nombre, el equipo y las instrucciones
reales del ejercicio en la base; no se inventó ningún dato.

## Tabla de cobertura (286 nombres WHOOP)

| Nombre WHOOP | Ejercicio equivalente (id) | ¿Cubierto? |
|---|---|---|
| Arnold Press - Seated - Dumbbell | Arnold Dumbbell Press (`Arnold_Dumbbell_Press`) | Sí |
| Around the World - Dumbbell | Around The Worlds (`Around_The_Worlds`) | Sí |
| Assault Bike | Air Bike (`Air_Bike`) | Sí |
| Back Extensions | Hyperextensions (Back Extensions) (`Hyperextensions_Back_Extensions`) | Sí |
| Back Squat - Barbell | Barbell Squat (`Barbell_Squat`) | Sí |
| Back Squat - Concentric - Barbell | Barbell Squat (`Barbell_Squat`) | Parcial |
| Back Squat - Low Bar | Barbell Squat (`Barbell_Squat`) | Parcial |
| Back Squat - Pause - Barbell | Barbell Squat (`Barbell_Squat`) | Parcial |
| Back Squat - Safety Bar | Barbell Squat (`Barbell_Squat`) | Parcial |
| Backward Lunge - Alternating - Barbell | Barbell Lunge (`Barbell_Lunge`) | Parcial |
| Backward Lunge - Alternating - Bodyweight | Bodyweight Walking Lunge (`Bodyweight_Walking_Lunge`) | Parcial |
| Backward Lunge - Alternating - Dumbbell | Dumbbell Rear Lunge (`Dumbbell_Rear_Lunge`) | Sí |
| Backward Lunge - Front Rack - Alternating - Barbell | Barbell Lunge (`Barbell_Lunge`) | Parcial |
| Backward Lunge - L - Dumbbell | Dumbbell Rear Lunge (`Dumbbell_Rear_Lunge`) | Sí |
| Backward Lunge - R - Dumbbell | Dumbbell Rear Lunge (`Dumbbell_Rear_Lunge`) | Sí |
| Bench Fly - Dumbbell | Dumbbell Flyes (`Dumbbell_Flyes`) | Sí |
| Bench Press - Barbell | Barbell Bench Press - Medium Grip (`Barbell_Bench_Press_-_Medium_Grip`) | Sí |
| Bench Press - Concentric - Barbell | Barbell Bench Press - Medium Grip (`Barbell_Bench_Press_-_Medium_Grip`) | Parcial |
| Bench Press - Decline - Barbell | Decline Barbell Bench Press (`Decline_Barbell_Bench_Press`) | Sí |
| Bench Press - Dumbbell | Dumbbell Bench Press (`Dumbbell_Bench_Press`) | Sí |
| Bench Press - Incline - Barbell | Barbell Incline Bench Press - Medium Grip (`Barbell_Incline_Bench_Press_-_Medium_Grip`) | Sí |
| Bench Press - Incline - Dumbbell | Incline Dumbbell Press (`Incline_Dumbbell_Press`) | Sí |
| Bench Press - Incline - Wide Grip - Barbell | Barbell Incline Bench Press - Medium Grip (`Barbell_Incline_Bench_Press_-_Medium_Grip`) | Parcial |
| Bench Press - Narrow Grip - Barbell | Close-Grip Barbell Bench Press (`Close-Grip_Barbell_Bench_Press`) | Sí |
| Bench Press - Pause - Barbell | Barbell Bench Press - Medium Grip (`Barbell_Bench_Press_-_Medium_Grip`) | Parcial |
| Bench Press - Wide Grip - Barbell | Wide-Grip Barbell Bench Press (`Wide-Grip_Barbell_Bench_Press`) | Sí |
| Bench Pull - Barbell | Incline Bench Pull (`Incline_Bench_Pull`) | Parcial |
| Bench Pullover - Dumbbell | Bent-Arm Dumbbell Pullover (`Bent-Arm_Dumbbell_Pullover`) | Sí |
| Bent Over Row - Barbell | Bent Over Barbell Row (`Bent_Over_Barbell_Row`) | Sí |
| Bent Over Row - Dumbbell | Bent Over Two-Dumbbell Row (`Bent_Over_Two-Dumbbell_Row`) | Sí |
| Bent Over Row - Underhand Grip - Barbell | Reverse Grip Bent-Over Rows (`Reverse_Grip_Bent-Over_Rows`) | Sí |
| Bicep Curl - Barbell | Barbell Curl (`Barbell_Curl`) | Sí |
| Bicep Curl - Cable | Standing Biceps Cable Curl (`Standing_Biceps_Cable_Curl`) | Sí |
| Bicep Curl - Drag - Barbell | Drag Curl (`Drag_Curl`) | Sí |
| Bicep Curl - Dumbbell | Dumbbell Bicep Curl (`Dumbbell_Bicep_Curl`) | Sí |
| Bicep Curl - Seated - Barbell | Barbell Curl (`Barbell_Curl`) | Parcial |
| Box Jump | Front Box Jump (`Front_Box_Jump`) | Sí |
| Box Jump - Arm Swing | Front Box Jump (`Front_Box_Jump`) | Sí |
| Box Jump - Single Leg - L | Single-Leg Stride Jump (`Single-Leg_Stride_Jump`) | Parcial |
| Box Jump - Single Leg - R | Single-Leg Stride Jump (`Single-Leg_Stride_Jump`) | Parcial |
| Box Squat - Barbell | Box Squat (`Box_Squat`) | Sí |
| Box Squat - Pause - Barbell | Box Squat (`Box_Squat`) | Parcial |
| Burpee Pull Ups | — | No |
| Burpees | — | No |
| Cable Face Pulls | Face Pull (`Face_Pull`) | Sí |
| Calf Raise - Seated | Seated Calf Raise (`Seated_Calf_Raise`) | Sí |
| Clean Pull - Barbell | Clean Pull (`Clean_Pull`) | Sí |
| Clean Pull - Off Blocks - Barbell | Clean Pull (`Clean_Pull`) | Parcial |
| Concentration Curl - L - Dumbbell | Concentration Curls (`Concentration_Curls`) | Sí |
| Concentration Curl - R - Dumbbell | Concentration Curls (`Concentration_Curls`) | Sí |
| Concentric Jump Squat - Barbell | Weighted Jump Squat (`Weighted_Jump_Squat`) | Parcial |
| Countermovement Jump | Rocket Jump (`Rocket_Jump`) | Sí |
| Countermovement Jump - Single Leg - Alternating | Single-Leg Stride Jump (`Single-Leg_Stride_Jump`) | Parcial |
| Countermovement Jump - Single Leg - L | Single-Leg Stride Jump (`Single-Leg_Stride_Jump`) | Parcial |
| Countermovement Jump - Single Leg - R | Single-Leg Stride Jump (`Single-Leg_Stride_Jump`) | Parcial |
| Crunches | Crunches (`Crunches`) | Sí |
| DB Bench Y Raise | — | No |
| Deadbug | Dead Bug (`Dead_Bug`) | Sí |
| Deadlift - Barbell | Barbell Deadlift (`Barbell_Deadlift`) | Sí |
| Deadlift - Dumbbell | Stiff-Legged Dumbbell Deadlift (`Stiff-Legged_Dumbbell_Deadlift`) | Parcial |
| Deadlift - Kettlebell | Kettlebell One-Legged Deadlift (`Kettlebell_One-Legged_Deadlift`) | Parcial |
| Deadlift - Off Blocks - Barbell | Rack Pulls (`Rack_Pulls`) | Sí |
| Deadlift - Sumo - Barbell | Sumo Deadlift (`Sumo_Deadlift`) | Sí |
| Deadlift - Sumo - Dumbbell | Sumo Deadlift (`Sumo_Deadlift`) | Parcial |
| Deadlift - Trapbar | Trap Bar Deadlift (`Trap_Bar_Deadlift`) | Sí |
| Deadlift - Wide Grip - Barbell | Snatch Deadlift (`Snatch_Deadlift`) | Sí |
| Dip | Dips - Triceps Version (`Dips_-_Triceps_Version`) | Sí |
| Elliptical | Elliptical Trainer (`Elliptical_Trainer`) | Sí |
| Farmer's Walk - Dumbbell | Farmer's Walk (`Farmers_Walk`) | Sí |
| Farmer's Walk - Kettlebell | Farmer's Walk (`Farmers_Walk`) | Sí |
| Front Plank | Plank (`Plank`) | Sí |
| Front Rack Lunge - Alternating - Barbell | Barbell Lunge (`Barbell_Lunge`) | Parcial |
| Front Shoulder Raise - Dumbbell | Front Dumbbell Raise (`Front_Dumbbell_Raise`) | Sí |
| Front Squat - Barbell | Front Barbell Squat (`Front_Barbell_Squat`) | Sí |
| Front Squat - Dumbbell | Dumbbell Squat (`Dumbbell_Squat`) | Parcial |
| Front Squat - Kettlebell | Front Squats With Two Kettlebells (`Front_Squats_With_Two_Kettlebells`) | Sí |
| Front Squat - Pause - Barbell | Front Barbell Squat (`Front_Barbell_Squat`) | Parcial |
| Glute Abductor Machine | Thigh Abductor (`Thigh_Abductor`) | Sí |
| Glute Bridge | Butt Lift (Bridge) (`Butt_Lift_Bridge`) | Sí |
| Glute Bridge - Single Leg - L | Single Leg Glute Bridge (`Single_Leg_Glute_Bridge`) | Sí |
| Glute Bridge - Single Leg - R | Single Leg Glute Bridge (`Single_Leg_Glute_Bridge`) | Sí |
| Glute Ham Raise | Glute Ham Raise (`Glute_Ham_Raise`) | Sí |
| Goblet Side Lunge - L - Dumbbell | Barbell Side Split Squat (`Barbell_Side_Split_Squat`) | Parcial |
| Goblet Side Lunge - R - Dumbbell | Barbell Side Split Squat (`Barbell_Side_Split_Squat`) | Parcial |
| Goblet Squat - Dumbbell | Goblet Squat (`Goblet_Squat`) | Sí |
| Goblet Squat - Kettlebell | Goblet Squat (`Goblet_Squat`) | Sí |
| Good Morning - Barbell | Good Morning (`Good_Morning`) | Sí |
| Groin Adductor Machine | Thigh Adductor (`Thigh_Adductor`) | Sí |
| Hack Squat | Hack Squat (`Hack_Squat`) | Sí |
| Half Kneeling Cable Pallof Press - L | Pallof Press (`Pallof_Press`) | Parcial |
| Half Kneeling Cable Pallof Press - R | Pallof Press (`Pallof_Press`) | Parcial |
| Hang Clean High Pull - Barbell | Clean Pull (`Clean_Pull`) | Parcial |
| Hang Clean Pull - Barbell | Clean Pull (`Clean_Pull`) | Parcial |
| Hang Power Clean - Barbell | Hang Clean (`Hang_Clean`) | Parcial |
| Hang Power Snatch - Barbell | Hang Snatch (`Hang_Snatch`) | Parcial |
| Hang Power Snatch - Dumbbell | Hang Snatch (`Hang_Snatch`) | Parcial |
| Hang Snatch - Barbell | Hang Snatch (`Hang_Snatch`) | Sí |
| Hang Snatch High Pull - Barbell | Snatch Pull (`Snatch_Pull`) | Parcial |
| Hanging Knee Raises | Hanging Leg Raise (`Hanging_Leg_Raise`) | Parcial |
| Hanging Leg Raises | Hanging Leg Raise (`Hanging_Leg_Raise`) | Sí |
| Hanging Tic Tocs | — | No |
| Hanging Toes to Bar | Hanging Leg Raise (`Hanging_Leg_Raise`) | Parcial |
| Hip Thrust - Barbell | Barbell Hip Thrust (`Barbell_Hip_Thrust`) | Sí |
| Incline Row - Dumbbell | Dumbbell Incline Row (`Dumbbell_Incline_Row`) | Sí |
| Incline Row - Machine | Dumbbell Incline Row (`Dumbbell_Incline_Row`) | Parcial |
| Inverted Row - Bent Knee - Barbell | Inverted Row (`Inverted_Row`) | Parcial |
| Inverted Row - Feet on Bench | Inverted Row (`Inverted_Row`) | Parcial |
| Inverted Row - Rings | Inverted Row with Straps (`Inverted_Row_with_Straps`) | Sí |
| Inverted Row - Straight Leg - TRX | Inverted Row with Straps (`Inverted_Row_with_Straps`) | Sí |
| Jump Rope | Rope Jumping (`Rope_Jumping`) | Sí |
| Jump Squat - Barbell | Weighted Jump Squat (`Weighted_Jump_Squat`) | Sí |
| Jumping Jacks | — | No |
| Kettlebell Cleans | One-Arm Kettlebell Clean (`One-Arm_Kettlebell_Clean`) | Sí |
| Kneeling Cable Pallof Press - L | Pallof Press (`Pallof_Press`) | Parcial |
| Kneeling Cable Pallof Press - R | Pallof Press (`Pallof_Press`) | Parcial |
| Kneeling Cable Rotation - L | Standing Cable Wood Chop (`Standing_Cable_Wood_Chop`) | Parcial |
| Kneeling Cable Rotation - R | Standing Cable Wood Chop (`Standing_Cable_Wood_Chop`) | Parcial |
| Kneeling Cable Vertical Pallof Press - L | Pallof Press (`Pallof_Press`) | Parcial |
| Kneeling Cable Vertical Pallof Press - R | Pallof Press (`Pallof_Press`) | Parcial |
| Kneeling Landmine Press - L | — | No |
| Kneeling Landmine Press - R | — | No |
| Kneeling Rollouts | Barbell Ab Rollout - On Knees (`Barbell_Ab_Rollout_-_On_Knees`) | Sí |
| Kneeling Squat Jump | Kneeling Jump Squat (`Kneeling_Jump_Squat`) | Sí |
| Landmine Press - Standing - L - Barbell | — | No |
| Landmine Press - Standing - R - Barbell | — | No |
| Lat Pull Down - Behind Neck | Wide-Grip Pulldown Behind The Neck (`Wide-Grip_Pulldown_Behind_The_Neck`) | Parcial |
| Lat Pull Down - Front | Full Range-Of-Motion Lat Pulldown (`Full_Range-Of-Motion_Lat_Pulldown`) | Sí |
| Lat Pull Down - Narrow Grip | Close-Grip Front Lat Pulldown (`Close-Grip_Front_Lat_Pulldown`) | Sí |
| Lat Pull Down - Wide Grip Behind Neck | Wide-Grip Pulldown Behind The Neck (`Wide-Grip_Pulldown_Behind_The_Neck`) | Sí |
| Lat Pull Down - Wide Grip Front Pull | Wide-Grip Lat Pulldown (`Wide-Grip_Lat_Pulldown`) | Sí |
| Lateral Barrier Jump | Lateral Bound (`Lateral_Bound`) | Parcial |
| Lateral Box Jump | Lateral Box Jump (`Lateral_Box_Jump`) | Sí |
| Lateral Lunge - Goblet - Alternating - Dumbbell | Barbell Side Split Squat (`Barbell_Side_Split_Squat`) | Parcial |
| Lateral Raise - Cable - L | Cable Seated Lateral Raise (`Cable_Seated_Lateral_Raise`) | Sí |
| Lateral Raise - Cable - R | Cable Seated Lateral Raise (`Cable_Seated_Lateral_Raise`) | Sí |
| Lateral Shoulder Raise - Dumbbell | Side Lateral Raise (`Side_Lateral_Raise`) | Sí |
| Leg Press | Leg Press (`Leg_Press`) | Sí |
| Lunge - Alternating - Barbell | Barbell Lunge (`Barbell_Lunge`) | Sí |
| Lunge - Alternating - Dumbbell | Dumbbell Lunges (`Dumbbell_Lunges`) | Sí |
| Lunge - L - Barbell | Barbell Lunge (`Barbell_Lunge`) | Sí |
| Lunge - R - Barbell | Barbell Lunge (`Barbell_Lunge`) | Sí |
| Machine Chest Flys | Butterfly (`Butterfly`) | Sí |
| Machine Chest Press | Machine Bench Press (`Machine_Bench_Press`) | Sí |
| Machine Shoulder Flys | — | No |
| Muscle Ups | Muscle Up (`Muscle_Up`) | Sí |
| Overhead Press - Barbell | Barbell Shoulder Press (`Barbell_Shoulder_Press`) | Sí |
| Overhead Press - Behind the Neck | Standing Barbell Press Behind Neck (`Standing_Barbell_Press_Behind_Neck`) | Sí |
| Overhead Press - Seated - Dumbbell | Seated Dumbbell Press (`Seated_Dumbbell_Press`) | Sí |
| Overhead Press - Smith Machine | Smith Machine Overhead Shoulder Press (`Smith_Machine_Overhead_Shoulder_Press`) | Sí |
| Overhead Press - Wide Grip - Barbell | Barbell Shoulder Press (`Barbell_Shoulder_Press`) | Parcial |
| Overhead Slam - Med Ball | Overhead Slam (`Overhead_Slam`) | Sí |
| Overhead Squat - Barbell | Overhead Squat (`Overhead_Squat`) | Sí |
| Overhead Squat - Single Arm - L - Dumbbell | One-Arm Overhead Kettlebell Squats (`One-Arm_Overhead_Kettlebell_Squats`) | Parcial |
| Overhead Squat - Single Arm - R - Dumbbell | One-Arm Overhead Kettlebell Squats (`One-Arm_Overhead_Kettlebell_Squats`) | Parcial |
| Overhead Squat - Single Arm - L - Kettlebell | One-Arm Overhead Kettlebell Squats (`One-Arm_Overhead_Kettlebell_Squats`) | Sí |
| Overhead Squat - Single Arm - R - Kettlebell | One-Arm Overhead Kettlebell Squats (`One-Arm_Overhead_Kettlebell_Squats`) | Sí |
| Pike | — | No |
| Pistol Squat - L - Kettlebell | Kettlebell Pistol Squat (`Kettlebell_Pistol_Squat`) | Sí |
| Pistol Squat - R - Kettlebell | Kettlebell Pistol Squat (`Kettlebell_Pistol_Squat`) | Sí |
| Power Clean - Barbell | Power Clean (`Power_Clean`) | Sí |
| Power Clean - Off Blocks - Barbell | Power Clean from Blocks (`Power_Clean_from_Blocks`) | Sí |
| Power Pull - Trap Bar | — | No |
| Power Snatch - Barbell | Power Snatch (`Power_Snatch`) | Sí |
| Preacher Curl | Preacher Curl (`Preacher_Curl`) | Sí |
| Prone Leg Curl | Lying Leg Curls (`Lying_Leg_Curls`) | Sí |
| Pull Up | Pullups (`Pullups`) | Sí |
| Pull Up - Neutral Grip | V-Bar Pullup (`V-Bar_Pullup`) | Sí |
| Pull Ups - Chest to Bar | Pullups (`Pullups`) | Parcial |
| Push Jerk - Barbell | Power Jerk (`Power_Jerk`) | Sí |
| Push Press - Barbell | Push Press (`Push_Press`) | Sí |
| Push Up | Pushups (`Pushups`) | Sí |
| Quarter Squat - Barbell | Barbell Squat (`Barbell_Squat`) | Parcial |
| Rear Foot Elevated Split Squat - L - Barbell | One Leg Barbell Squat (`One_Leg_Barbell_Squat`) | Sí |
| Rear Foot Elevated Split Squat - R - Barbell | One Leg Barbell Squat (`One_Leg_Barbell_Squat`) | Sí |
| Reverse Back Extensions | Reverse Hyperextension (`Reverse_Hyperextension`) | Sí |
| Reverse Curls - Barbell | Reverse Barbell Curl (`Reverse_Barbell_Curl`) | Sí |
| Reverse Fly - Dumbbell | Reverse Flyes (`Reverse_Flyes`) | Sí |
| Romanian Deadlift - Barbell | Romanian Deadlift (`Romanian_Deadlift`) | Sí |
| Romanian Deadlift - Dumbbell | Stiff-Legged Dumbbell Deadlift (`Stiff-Legged_Dumbbell_Deadlift`) | Parcial |
| Romanian Deadlift - Kettlebell | Romanian Deadlift (`Romanian_Deadlift`) | Parcial |
| Romanian Deadlift - Single Leg - Alternating - Barbell | Romanian Deadlift (`Romanian_Deadlift`) | Parcial |
| Romanian Deadlift - Single Leg - Alternating - Dumbbell | Kettlebell One-Legged Deadlift (`Kettlebell_One-Legged_Deadlift`) | Parcial |
| Romanian Deadlift - Single Leg - L - Barbell | Romanian Deadlift (`Romanian_Deadlift`) | Parcial |
| Romanian Deadlift - Single Leg - L - Dumbbell | Kettlebell One-Legged Deadlift (`Kettlebell_One-Legged_Deadlift`) | Parcial |
| Romanian Deadlift - Single Leg - R - Barbell | Romanian Deadlift (`Romanian_Deadlift`) | Parcial |
| Romanian Deadlift - Single Leg - R - Dumbbell | Kettlebell One-Legged Deadlift (`Kettlebell_One-Legged_Deadlift`) | Parcial |
| Row - Single Arm - L - Dumbbell | One-Arm Dumbbell Row (`One-Arm_Dumbbell_Row`) | Sí |
| Row - Single Arm - R - Dumbbell | One-Arm Dumbbell Row (`One-Arm_Dumbbell_Row`) | Sí |
| Rowing | Rowing, Stationary (`Rowing_Stationary`) | Sí |
| Running | Running, Treadmill (`Running_Treadmill`) | Sí |
| Seated Machine Leg Curl | Seated Leg Curl (`Seated_Leg_Curl`) | Sí |
| Seated Machine Leg Extension | Leg Extensions (`Leg_Extensions`) | Sí |
| Seated Row | Seated Cable Rows (`Seated_Cable_Rows`) | Sí |
| Shin Locked Squat | — | No |
| Shoulder Press - Machine | Machine Shoulder (Military) Press (`Machine_Shoulder_Military_Press`) | Sí |
| Shrugs - Barbell | Barbell Shrug (`Barbell_Shrug`) | Sí |
| Shrugs - Cable | Cable Shrugs (`Cable_Shrugs`) | Sí |
| Shrugs - Dumbbell | Dumbbell Shrug (`Dumbbell_Shrug`) | Sí |
| Side Lunge - Alternating - Barbell | Barbell Side Split Squat (`Barbell_Side_Split_Squat`) | Parcial |
| Side Plank - L | Side Bridge (`Side_Bridge`) | Sí |
| Side Plank - R | Side Bridge (`Side_Bridge`) | Sí |
| Single Arm Bent Over Row - L - Cable | Bent Over One-Arm Long Bar Row (`Bent_Over_One-Arm_Long_Bar_Row`) | Parcial |
| Single Arm Bent Over Row - R - Cable | Bent Over One-Arm Long Bar Row (`Bent_Over_One-Arm_Long_Bar_Row`) | Parcial |
| Single Arm Press - L - Dumbbell | Dumbbell One-Arm Shoulder Press (`Dumbbell_One-Arm_Shoulder_Press`) | Sí |
| Single Arm Press - L - Kettlebell | One-Arm Kettlebell Military Press To The Side (`One-Arm_Kettlebell_Military_Press_To_The_Side`) | Parcial |
| Single Arm Press - R - Dumbbell | Dumbbell One-Arm Shoulder Press (`Dumbbell_One-Arm_Shoulder_Press`) | Sí |
| Single Arm Press - R - Kettlebell | One-Arm Kettlebell Military Press To The Side (`One-Arm_Kettlebell_Military_Press_To_The_Side`) | Parcial |
| Single Arm Snatch - L - Dumbbell | One-Arm Kettlebell Snatch (`One-Arm_Kettlebell_Snatch`) | Parcial |
| Single Arm Snatch - L - Kettlebell | One-Arm Kettlebell Snatch (`One-Arm_Kettlebell_Snatch`) | Sí |
| Single Arm Snatch - R - Dumbbell | One-Arm Kettlebell Snatch (`One-Arm_Kettlebell_Snatch`) | Parcial |
| Single Arm Snatch - R - Kettlebell | One-Arm Kettlebell Snatch (`One-Arm_Kettlebell_Snatch`) | Sí |
| Sit ups | Sit-Up (`Sit-Up`) | Sí |
| Skull Crusher - Flat Bench - Barbell | Lying Triceps Press (`Lying_Triceps_Press`) | Parcial |
| Sled Lateral Walks | — | No |
| Sled Pull | Sled Drag - Harness (`Sled_Drag_-_Harness`) | Sí |
| Sled Push | Sled Push (`Sled_Push`) | Sí |
| Smith Machine Bench Press | Smith Machine Bench Press (`Smith_Machine_Bench_Press`) | Sí |
| Smith Machine Hip Thrust | Smith Machine Hip Raise (`Smith_Machine_Hip_Raise`) | Sí |
| Smith Machine Incline Bench Press | Smith Machine Incline Bench Press (`Smith_Machine_Incline_Bench_Press`) | Sí |
| Smith Machine Squat | Smith Machine Squat (`Smith_Machine_Squat`) | Sí |
| Snatch - Barbell | Snatch (`Snatch`) | Sí |
| Snatch High Pull - Barbell | Snatch Pull (`Snatch_Pull`) | Parcial |
| Snatch Pull - Barbell | Snatch Pull (`Snatch_Pull`) | Sí |
| Spin | Bicycling, Stationary (`Bicycling_Stationary`) | Sí |
| Split Jerk - Barbell | Split Jerk (`Split_Jerk`) | Sí |
| Split Squat - L - Barbell | One Leg Barbell Squat (`One_Leg_Barbell_Squat`) | Parcial |
| Split Squat - L - Dumbbell | Split Squat with Dumbbells (`Split_Squat_with_Dumbbells`) | Parcial |
| Split Squat - R - Barbell | One Leg Barbell Squat (`One_Leg_Barbell_Squat`) | Parcial |
| Split Squat - R - Dumbbell | Split Squat with Dumbbells (`Split_Squat_with_Dumbbells`) | Parcial |
| Split Squat - Rear Foot Elevated - L - Dumbbell | Split Squat with Dumbbells (`Split_Squat_with_Dumbbells`) | Sí |
| Split Squat - Rear Foot Elevated - R - Dumbbell | Split Squat with Dumbbells (`Split_Squat_with_Dumbbells`) | Sí |
| Split Stance Cable Pallof Press - L | Pallof Press (`Pallof_Press`) | Parcial |
| Split Stance Cable Pallof Press - R | Pallof Press (`Pallof_Press`) | Parcial |
| Squat - Single Leg - L | Kettlebell Pistol Squat (`Kettlebell_Pistol_Squat`) | Parcial |
| Squat - Single Leg - R | Kettlebell Pistol Squat (`Kettlebell_Pistol_Squat`) | Parcial |
| Squat Jump | Freehand Jump Squat (`Freehand_Jump_Squat`) | Sí |
| Stairmaster | Stairmaster (`Stairmaster`) | Sí |
| Standing Cable Crossover | Cable Crossover (`Cable_Crossover`) | Sí |
| Standing Cable Pallof Press - L | Pallof Press (`Pallof_Press`) | Sí |
| Standing Cable Pallof Press - R | Pallof Press (`Pallof_Press`) | Sí |
| Standing Cable Rotations - L | Standing Cable Wood Chop (`Standing_Cable_Wood_Chop`) | Parcial |
| Standing Cable Rotations - R | Standing Cable Wood Chop (`Standing_Cable_Wood_Chop`) | Parcial |
| Standing Cable Vertical Pallof Press - L | Pallof Press (`Pallof_Press`) | Parcial |
| Standing Cable Vertical Pallof Press - R | Pallof Press (`Pallof_Press`) | Parcial |
| Standing Chest Throw - Med Ball | Medicine Ball Chest Pass (`Medicine_Ball_Chest_Pass`) | Sí |
| Standing Landmine Rotations | Landmine 180's (`Landmine_180s`) | Sí |
| Standing Leg Curl - L | Standing Leg Curl (`Standing_Leg_Curl`) | Sí |
| Standing Leg Curl - R | Standing Leg Curl (`Standing_Leg_Curl`) | Sí |
| Standing Row - Cable | Seated Cable Rows (`Seated_Cable_Rows`) | Parcial |
| Standing Side Throw - L - Med Ball | — | No |
| Standing Side Throw - R - Med Ball | — | No |
| Standing Triceps Extension - Dumbbell | Standing Dumbbell Triceps Extension (`Standing_Dumbbell_Triceps_Extension`) | Sí |
| Step Up - Alternating - Dumbbell | Dumbbell Step Ups (`Dumbbell_Step_Ups`) | Sí |
| Step Up - L - Barbell | Barbell Step Ups (`Barbell_Step_Ups`) | Sí |
| Step Up - L - Dumbbell | Dumbbell Step Ups (`Dumbbell_Step_Ups`) | Sí |
| Step Up - R - Barbell | Barbell Step Ups (`Barbell_Step_Ups`) | Sí |
| Step Up - R - Dumbbell | Dumbbell Step Ups (`Dumbbell_Step_Ups`) | Sí |
| Step Ups - Alternating - Barbell | Barbell Step Ups (`Barbell_Step_Ups`) | Sí |
| Step Ups - Alternating - WEIGHTED | Dumbbell Step Ups (`Dumbbell_Step_Ups`) | Sí |
| Straight Arm Pull Down | Straight-Arm Pulldown (`Straight-Arm_Pulldown`) | Sí |
| Supine Lying Chest Throw - Med Ball | Supine Chest Throw (`Supine_Chest_Throw`) | Sí |
| Swing - Kettlebell | One-Arm Kettlebell Swings (`One-Arm_Kettlebell_Swings`) | Parcial |
| Swing - Single Arm - L - Kettlebell | One-Arm Kettlebell Swings (`One-Arm_Kettlebell_Swings`) | Sí |
| Swing - Single Arm - R - Kettlebell | One-Arm Kettlebell Swings (`One-Arm_Kettlebell_Swings`) | Sí |
| T-Bar Row - Barbell | T-Bar Row with Handle (`T-Bar_Row_with_Handle`) | Sí |
| Thruster - Barbell | Kettlebell Thruster (`Kettlebell_Thruster`) | Parcial |
| Thruster - Dumbbell | Kettlebell Thruster (`Kettlebell_Thruster`) | Parcial |
| Tic Tocs | — | No |
| Tire Flip | Tire Flip (`Tire_Flip`) | Sí |
| Travelling Lunge - 45 Degree - Dumbbell | Dumbbell Lunges (`Dumbbell_Lunges`) | Parcial |
| Travelling Lunge - Alternating - Barbell | Barbell Walking Lunge (`Barbell_Walking_Lunge`) | Sí |
| Travelling Lunge - Alternating - Dumbbell | Dumbbell Lunges (`Dumbbell_Lunges`) | Parcial |
| Travelling Lunge - L - Dumbbell | Dumbbell Lunges (`Dumbbell_Lunges`) | Parcial |
| Travelling Lunge - R - Dumbbell | Dumbbell Lunges (`Dumbbell_Lunges`) | Parcial |
| Tricep Extension - Standing - Rope - Pulley Machine | Triceps Overhead Extension with Rope (`Triceps_Overhead_Extension_with_Rope`) | Sí |
| Tricep Extension - Supine Lying - Dumbbell | Lying Dumbbell Tricep Extension (`Lying_Dumbbell_Tricep_Extension`) | Sí |
| Tricep Kickback - Single Arm - L - Dumbbell | Tricep Dumbbell Kickback (`Tricep_Dumbbell_Kickback`) | Sí |
| Tricep Kickback - Single Arm - R - Dumbbell | Tricep Dumbbell Kickback (`Tricep_Dumbbell_Kickback`) | Sí |
| Triceps Extension - Single Arm Seated - L - Dumbbell | Dumbbell One-Arm Triceps Extension (`Dumbbell_One-Arm_Triceps_Extension`) | Sí |
| Triceps Extension - Single Arm Seated - R - Dumbbell | Dumbbell One-Arm Triceps Extension (`Dumbbell_One-Arm_Triceps_Extension`) | Sí |
| Triceps Pulldown - Rope | Triceps Pushdown - Rope Attachment (`Triceps_Pushdown_-_Rope_Attachment`) | Sí |
| Tuck Jump | Knee Tuck Jump (`Knee_Tuck_Jump`) | Sí |
| Turkish Get Up - L | Kettlebell Turkish Get-Up (Lunge style) (`Kettlebell_Turkish_Get-Up_Lunge_style`) | Sí |
| Turkish Get Up - R | Kettlebell Turkish Get-Up (Lunge style) (`Kettlebell_Turkish_Get-Up_Lunge_style`) | Sí |
| Upright Row - Barbell | Upright Barbell Row (`Upright_Barbell_Row`) | Sí |
| Vertical Toss - Med Ball | Medicine Ball Scoop Throw (`Medicine_Ball_Scoop_Throw`) | Parcial |

## Resultado

| Métrica | Conteo | % |
|---|---|---|
| Sí (equivalente directo) | 176 | 61.5% |
| Parcial (patrón cubierto, variante no) | 93 | 32.5% |
| No cubierto | 17 | 5.9% |

- **Cobertura estricta (solo Sí): 176/286 = 61.5%**
- **Cobertura amplia (Sí + Parcial): 269/286 = 94.1%**

Huecos destacados (sin equivalente): burpees, jumping jacks, landmine press
(de pie y de rodillas), lanzamiento lateral de balón medicinal, tic tocs,
Y raise en banco, sled lateral walk, máquina de vuelos de hombro, power pull
con trap bar, shin locked squat y pike.
