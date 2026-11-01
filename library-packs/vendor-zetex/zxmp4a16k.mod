*
*Zetex ZXMP4A16K Spice Model v1.0 Last Revised 09/10/06
*
.SUBCKT ZXMP4A16K 30 40 50
*                D G S
M1 6 2 5 5 Pmod L=1.2E-6 W=1.67 
M2 5 2 5 6 Nmod L=1.4E-6 W=0.96
RG 4 2 2
RIN 2 5 1E9
RD 3 6 Rdmod 0.018
RL 3 5 3E9
C1 2 5 40E-12
C2 3 4 25E-12
D1 3 5  Dbodymod
LD 3 30 1.3E-9
LG 4 40 2.4E-9
LS 5 50 2.4E-9
.MODEL Pmod PMOS (LEVEL=3 TOX=5.5E-8 NSUB=4E16
+VTO=-1.8 KP=1.6E-5 RS=.022 NFS=2E11 KAPPA=0.06 UO=650 IS=1E-15 N=10)
.MODEL Nmod NMOS (LEVEL=3 TOX=5.5E-8 NSUB=2E16 
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=5E-12 RS=.018 IKF=0.1 TRS1=1.5e-3
+CJO=450e-12 TT=2.2e-8  BV=44)
.MODEL Rdmod RES (TC1=8e-3 TC2=1.5E-5)
.ENDS   ZXMP4A16K
*
*$
*
*                (c)  2006 Zetex Semiconductors plc
*
*   The copyright in these models  and  the designs embodied belong
*   to Zetex Semiconductors plc (" Zetex ").  They  are  supplied
*   free of charge by Zetex for the purpose of research and design
*   and may be used or copied intact  (including this notice)  for
*   that purpose only.  All other rights are reserved. The models
*   are believed accurate but  no condition  or warranty  as to their
*   merchantability or fitness for purpose is given and no liability
*   in respect of any use is accepted by Zetex PLC, its distributors
*   or agents.
*
*   Zetex Semiconductors plc, Zetex Technology Park, Chadderton,
*   Oldham, United Kingdom, OL9 9LL


